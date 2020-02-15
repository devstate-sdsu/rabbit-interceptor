const request = require("request-promise");
const cheerio = require("cheerio");
const URL = require("url-parse");
const admin = require("firebase-admin");
const moment = require("moment");


admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    databaseURL: "https://rabbitbums.firebaseio.com/"
  });

let db = admin.firestore();

scrapeFromMainPage().then((res) => {
    for (let i = 0; i < res.documents.length; i++) {
        event = res.documents[i];
        id = res.documentIds[i];
        db.collection('testEventsCol').doc(id).set(event).then(ref => {
            console.log('Added document with ID: ', ref.id);
        }).catch(e => {
            console.log("ERROR WITH FIRESTORE: " + e);
        });
    }
});

async function scrapeFromMainPage() {
    const base = "https://www.sdstate.edu/events/list?department=All&title=&page=";
    const crossYear = {
        firstEventIsJan: true,
        incrementNow : false,
    };
    let masterObj = {};
    masterObj['documents'] = [];
    masterObj['documentIds'] = [];
    for (let i = 0; i < 15; i++) {
        const pageToVisit = base + i.toString();
        console.log("Visiting page: ", pageToVisit);
        masterObj = await collectEventsPromise(pageToVisit, masterObj, crossYear, i);
    }
    return masterObj;
}

async function collectEventsPromise(pageToVisit, masterObj, crossYear, i) {
    masterAry = masterObj.documents;
    masterIdAry = masterObj.documentIds;
    return new Promise((resolve, reject) => {
        request(pageToVisit).then((body) => {
            let $ = cheerio.load(body);
            console.log("Page title: " + $('title').text());
            collectEvents($, crossYear, i).then((result) => {
                if (result.documents.length === 0) {
                    resolve({
                        documents: masterAry,
                        documentIds: masterIdAry
                    });
                } else if (result.documents.length > 0) {
                    resolve({
                        documents: masterAry.concat(result.documents),
                        documentIds: masterIdAry.concat(result.documentIds)
                    });
                }
            });
        }).catch(e => {
            console.log("ERROR COLLECTING EVENTS: " + e);
        });
    });
}

async function collectEvents($, crossYear, pageNum) {
    const objAry = [];
    const idAry = [];
    const detailBase = "https://www.sdstate.edu";
    const detailUrlAry = [];

    // Scrape title
    const titleToken = '.featured-list-item__title>a';
    $(titleToken).each((idx, elem) => {
        const newObj = {};
        let str = $(elem).text();
        str = str.trim();
        newObj['name'] = str;
        newObj['tags'] = []
        const detailUrl = detailBase + $(elem).attr('href');
        detailUrlAry.push(detailUrl);
        objAry.push(newObj);
        idAry.push('');
    });

    // Scrape location and unique post id (event id) from detail page
    for (let i = 0; i < detailUrlAry.length; i++) {
        const url = detailUrlAry[i];
        await request(url)
        .then((body) => {
            let $$ = cheerio.load(body);
            const locationToken = 'span.event__detail:has(a)';
            $$(locationToken).each((idx, elem) => {
                let str = $$(elem).text();
                str = str.trim();
                const locationCommaIdx = str.indexOf(',');
                let bigLocation = '';
                let tinyLocation = '';
                if (locationCommaIdx != -1) {
                    bigLocation = str.slice(0, locationCommaIdx);
                    tinyLocation = str.slice(locationCommaIdx + 1);
                } else {
                    bigLocation = str;
                }
                bigLocation = bigLocation.trim();
                tinyLocation = tinyLocation.trim();
                objAry[i]['big_location'] = bigLocation;
                objAry[i]['tiny_location'] = tinyLocation;
            }); 
            const idToken = '[itemprop="acquia_lift:content_uuid"]';
            $$(idToken).each((idx, elem) => {
                let id = $(elem).attr('content');
                idAry[i] = id;
            });

        }).catch((e) => {
            console.log("ERROR SCRAPING FROM DETAIL PAGE: " + e);
        });
    }

    // Scrape description & add summary
    const descriptionToken = 'div.featured-list-item__content:has(h3.featured-list-item__title)';
    $(descriptionToken).each((idx, elem) => {
        let str = $(elem).find('p').text();
        str = str.trim();
        objAry[idx]['description'] = str;
        objAry[idx]['summary'] = str.slice(0, Math.min(str.length, 140));      // Follow twitter rules plz
    });

    // Scrape time
    const timeToken = 'div.featured-list-item__content:has(h3.featured-list-item__title)';
    $(timeToken).each((idx, elem) => {
        let str = $(elem).find('span.metadata--event').slice(0, 1).text();
        str = str.trim();
        const commaIdx = str.indexOf('‚');
        const dashIdx = str.indexOf('–');
        const dayMonth = str.slice(0, commaIdx);
        const startTime = str.slice(commaIdx + 1, dashIdx);
        const endTime = str.slice(dashIdx + 1);
        const objWithDate = moment(dayMonth, ['MMM. D', 'MMM. DD']).toDate();
        if (objWithDate.getMonth() !== 0 && pageNum === 0 && idx === 0) {
            crossYear.firstEventIsJan = false;
        }
        if (objWithDate.getMonth() === 0 && crossYear.firstEventIsJan === false) {
            crossYear.incrementNow = true;
        }
        const objWithStartTime = moment(startTime, ['hh:mm a', 'h:mm a']).toDate();
        const objWithEndTime = moment(endTime, ['hh:mm a', 'h:mm a']).toDate();
        objWithStartTime.setMonth(objWithDate.getMonth());
        objWithEndTime.setMonth(objWithDate.getMonth());
        objWithStartTime.setDate(objWithDate.getDay());
        objWithEndTime.setDate(objWithDate.getDay());
        if (crossYear.incrementNow) {
            const year = objWithStartTime.getFullYear();
            objWithStartTime.setFullYear(year + 1);
            objWithEndTime.setFullYear(year + 1);
        }

        try {
            objAry[idx]['start_time'] = admin.firestore.Timestamp.fromDate(new Date(objWithStartTime));
            objAry[idx]['end_time'] = admin.firestore.Timestamp.fromDate(new Date(objWithEndTime));
        } catch {
            objAry[idx]['start_time'] = admin.firestore.Timestamp.fromDate(new Date());
            objAry[idx]['end_time'] = admin.firestore.Timestamp.fromDate(new Date());
        }
        // Set time updated
        objAry[idx]['time_updated'] = admin.firestore.Timestamp.fromDate(new Date());
        // Set update note
        objAry[idx]['updates'] = "Re-scraped from the university website";
    });

    // Scrape img url and append tag for sporting events
    const imgToken = 'li.featured-list-item:has(h3.featured-list-item__title)';
    $(imgToken).each((idx, elem) => {
        let str = $(elem).find('img.b-lazy').attr('data-src');
        if (str) {
            str = str.trim();
            // Having the following url means that it is a sporting event.
            if (str.startsWith('/sites/default/files/styles/teaser_image_/public/2019-09/jacks%20Logo_0.jpg' ||
                str.startsWith('/sites/default/files/styles/teaser_image_/public/2018-11/Logo_2.jpg'))) {
                if (objAry[idx]['big_location'].includes('Frost Arena')) {
                    objAry[idx]['image'] = 'https://gojacks.com/images/2016/6/16/20090123tpc_003.jpg?width=500&height=300&mode=crop';
                } else if (objAry[idx]['big_location'].includes('University Student Union')) {
                    objAry[idx]['image'] = 'https://www.sdstate.edu/sites/default/files/styles/hero_extra_large/public/2018-10/2018_Students%20outside%20of%20Union_3571x2380.jpg';
                } else if (objAry[idx]['big_location'].includes('Wellness Center')) {
                    objAry[idx]['image'] = 'https://www.sdstate.edu/sites/default/files/2019-01/WCExpansionBannerHighRes.jpg';
                } else if (objAry[idx]['big_location'].includes('Dykhouse Stadium')) {
                    objAry[idx]['image'] = 'https://gojacks.com/images/2016/8/11/Stadium_Open_House_Teaser.jpg?width=500&height=300&mode=crop';
                } else {
                    objAry[idx]['image'] = 'https://www.sdstate.edu/sites/default/files/styles/card_large/public/hero/OverviewOfCampus.jpg';
                }
                objAry[idx]['tags'].push('sporting');
            } else {
                objAry[idx]['image'] = 'https://www.sdstate.edu' + str;                
            }
        } else {
            if (objAry[idx]['big_location'].includes('Frost Arena')) {
                objAry[idx]['image'] = 'https://gojacks.com/images/2016/6/16/20090123tpc_003.jpg?width=500&height=300&mode=crop';
            } else if (objAry[idx]['big_location'].includes('University Student Union')) {
                objAry[idx]['image'] = 'https://www.sdstate.edu/sites/default/files/styles/hero_extra_large/public/2018-10/2018_Students%20outside%20of%20Union_3571x2380.jpg';
            } else if (objAry[idx]['big_location'].includes('Wellness Center')) {
                objAry[idx]['image'] = 'https://www.sdstate.edu/sites/default/files/2019-01/WCExpansionBannerHighRes.jpg';
            } else if (objAry[idx]['big_location'].includes('Dykhouse Stadium')) {
                objAry[idx]['image'] = 'https://gojacks.com/images/2016/8/11/Stadium_Open_House_Teaser.jpg?width=500&height=300&mode=crop';
            } else if (objAry[idx]['big_location'].includes('Performing Arts Center')) {
                objAry[idx]['image'] = 'https://www.sdstate.edu/sites/default/files/styles/hero_extra_large/public/2019-08/PAC%20Larson%20Concert%20Hall.jpg';
            } else if (objAry[idx]['big_location'].includes('Library')) {
                objAry[idx]['image'] = 'https://www.sdstate.edu/sites/default/files/images/Tue-19/Briggs%20Library%20with%20flowers.jpg';
            } else if (objAry[idx]['big_location'].includes('Avera')) {
                objAry[idx]['image'] = 'https://i.ytimg.com/vi/KtX8Q79Heqk/maxresdefault.jpg';
            } else if (objAry[idx]['big_location'].includes('Daktronics')) {
                objAry[idx]['image'] = 'https://i.ytimg.com/vi/u3pwzl8nTLA/maxresdefault.jpg';
            } else if (objAry[idx]['big_location'].includes('Solberg')) {
                objAry[idx]['image'] = 'https://i.ytimg.com/vi/3hU3fEioA88/maxresdefault.jpg';
            } else {
                objAry[idx]['image'] = 'https://www.sdstate.edu/sites/default/files/styles/card_large/public/hero/OverviewOfCampus.jpg';
            }
        }
    });
    console.log(idAry);
    return {
        documents: objAry,
        documentIds: idAry
    };
}
