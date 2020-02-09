const request = require("request-promise");
const cheerio = require("cheerio");
const URL = require("url-parse");
const admin = require("firebase-admin");
const moment = require("moment");

admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    databaseURL: 'https://rabbitbums.firebaseio.com'
});

let db = admin.firestore();

scrapeFromMainPage().then((res) => {
    res.forEach((event) => {
        db.collection('autotestCol').add(event).then(ref => {
            console.log('Added document with ID: ', ref.id);
        }).catch(e => {
            console.log("ERROR WITH FIRESTORE: " + e);
        });
        // console.log("BIG LOCATION: ", event.big_location);
        // console.log("TINY LOCATION: ", event.tiny_location);
    });
});

async function scrapeFromMainPage() {
    const base = "https://www.sdstate.edu/events/list?department=All&title=&page=";
    const crossYear = {
        firstEventIsJan: true,
        incrementNow : false,
    };
    let masterAry = [];
    for (let i = 0; i < 15; i++) {
        const pageToVisit = base + i.toString();
        console.log("Visiting page: ", pageToVisit);
        masterAry = await collectEventsPromise(pageToVisit, masterAry, crossYear, i);
    }
    return masterAry;
}

async function collectEventsPromise(pageToVisit, masterAry, crossYear, i) {
    return new Promise((resolve, reject) => {
        request(pageToVisit).then((body) => {
            let $ = cheerio.load(body);
            console.log("Page title: " + $('title').text());
            collectEvents($, crossYear, i).then((result) => {
                if (result.length === 0) {
                    resolve(masterAry);
                } else if (result.length > 0) {
                    resolve(masterAry.concat(result));
                }
            });
        }).catch(e => {
            console.log("ERROR COLLECTING EVENTS: " + e);
        });
    });
}

async function collectEvents($, crossYear, pageNum) {
    const objAry = [];
    const detailBase = "https://www.sdstate.edu";
    const detailUrlAry = [];

    // Scrape title
    const titleToken = '.featured-list-item__title>a';
    $(titleToken).each((idx, elem) => {
        const newObj = {};
        let str = $(elem).text();
        str = str.trim();
        newObj['name'] = str;
        const detailUrl = detailBase + $(elem).attr('href');
        detailUrlAry.push(detailUrl);
        objAry.push(newObj);
    });

    // Scrape location from detail page
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

    // Scrape img url
    const imgToken = 'li.featured-list-item:has(h3.featured-list-item__title)';
    $(imgToken).each((idx, elem) => {
        let str = $(elem).find('img.b-lazy').attr('data-src');
        if (str) {
            str = str.trim();
            objAry[idx]['image'] = 'https://www.sdstate.edu' + str;
        } else {
            objAry[idx]['image'] = 'https://www.sdstate.edu/sites/default/files/images/Mon-19/Artboard%205%402x_1.png';
        }
    });
    return objAry;
}
