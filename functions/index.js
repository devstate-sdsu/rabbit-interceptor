const request = require("request-promise");
const cheerio = require("cheerio");
const URL = require("url-parse");
const admin = require("firebase-admin");
const moment = require("moment");
var { testing } = require('./config');
const functions = require('firebase-functions');


const eventsCollectionName = testing ? 'testEventsCol' : 'eventsCol';
const pagesToScrape = testing ? 3 : 10;

admin.initializeApp();

let db = admin.firestore();

async function getAllDocumentIds(ids) {
    let eventsRef = db.collection(eventsCollectionName);
    await eventsRef.get()
        .then(snapshot => {
            snapshot.forEach(doc => {
                if (!doc.data().tags.includes("clubs")) {
                    ids.add(doc.id);
                }
            });
            return ids;
        })
        .catch(err => {
            console.log("Error getting all document ids: " + err);
            return ids;
        })
}

async function deleteRemovedAndExpiredEvents(idsRemovedFromSite) {
    const idsAry = Array.from(idsRemovedFromSite);
    let batch = db.batch();
    for (let i = 0; i < idsAry.length; i++) {
        const id = idsAry[i];
        var docRef = db.collection(eventsCollectionName).doc(id);
        batch.delete(docRef);
    }
    await batch.commit().then(() => {
        console.log("Successfully deleted all sdstate-deleted events from the database");
        return;
    }).catch(() => {
        console.log("Error deleting from the database events that are deleted by sdstate.edu");
        return;
    });
    batch = db.batch();
    await db.collection(eventsCollectionName)
        .where('end_time', '<', admin.firestore.Timestamp.fromDate(new Date()))
        .get()
        .then((snapshot) => {
            snapshot.forEach(doc => {
                batch.delete(doc.ref);
            });
            return;
        }).catch((e) => {
            console.log("Error getting expired events");
        });
    await batch.commit().then(() => {
        console.log("Successfully deleted all expired events from the database");
        return;
    }).catch(() => {
        console.log("Error deleting expired events from the database");
        return;
    });    
    return;
}

exports.interceptCarrots = functions.https.onRequest((request, response) => {
    scrapeFromMainPage()
        .then((res) => {
            let batch = db.batch();
            for (let i = 0; i < res.documents.length; i++) {
                event = res.documents[i];
                id = res.documentIds[i];
                let docRef = db.collection(eventsCollectionName).doc(id);
                batch.set(docRef, event);
                batch.commit().then(ref => {
                    console.log('Added document with ID: ', ref.id);
                    return "OH YES ADDING/UPDATING EVENTS WORKED";
                }).catch(e => {
                    console.log("ERROR ADDING/UPDATING EVENTS WITH FIRESTORE: " + e);
                    return "OOPSIE";
                });
            }
            return;
        }).catch((e) => {
            console.log("Error scraping from main page" + e);
            return "OOPSIE";
        });
    response.send("success");
    return;
});

async function scrapeFromMainPage() {
    const idsRemovedFromSite = new Set();
    await getAllDocumentIds(idsRemovedFromSite);
    const base = "https://www.sdstate.edu/events/list?department=All&title=&page=";
    let masterObj = {};
    masterObj['documents'] = [];
    masterObj['documentIds'] = [];
    for (let i = 0; i < pagesToScrape; i++) {
        /* eslint-disable no-await-in-loop */
        const pageToVisit = base + i.toString();
        console.log("Visiting page: ", pageToVisit);
        masterObj = await collectEventsPromise(pageToVisit, masterObj, i);
    }
    const allIdxs = [];
    for (let i = 0; i < masterObj.documentIds.length; i++) {
        freshDocId = masterObj.documentIds[i];
        if (idsRemovedFromSite.has(freshDocId)) {
            idsRemovedFromSite.delete(freshDocId);
        }
    }

    await deleteRemovedAndExpiredEvents(idsRemovedFromSite);
    return masterObj;
}

async function collectEventsPromise(pageToVisit, masterObj, i) {
    masterAry = masterObj.documents;
    masterIdAry = masterObj.documentIds;
    return new Promise((resolve, reject) => {
        request(pageToVisit).then((body) => {
            let $ = cheerio.load(body);
            console.log("Page title: " + $('title').text());
            collectEvents($, i).then((result) => {
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
                return;
            }).catch(() => {
                console.log("Failed to visit a particular page: " + pageToVisit);
                return;
            });
            return;
        }).catch(e => {
            console.log("ERROR COLLECTING EVENTS: " + e);
        });
    });
}

async function collectEvents($, pageNum) {
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

    // Go into details page
    for (let i = 0; i < detailUrlAry.length; i++) {
        const url = detailUrlAry[i];
        await request(url)
        .then((body) => {
            let $$ = cheerio.load(body);

            // Scrape location
            const locationToken = 'span.event__detail:has(a)';
            $$(locationToken).each((idx, elem) => {
                let str = $$(elem).text();
                str = str.trim();
                const locationCommaIdx = str.indexOf(',');
                let bigLocation = '';
                let tinyLocation = '';
                if (locationCommaIdx !== -1) {
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

            // Scrape id
            const idToken = '[itemprop="acquia_lift:content_uuid"]';
            $$(idToken).each((idx, elem) => {
                let id = $(elem).attr('content');
                idAry[i] = id;
            });

            // Scrape date time
            var startDate = '';
            var endDate = '';
            var startTime = '';
            var endTime = '';
            const dateTimeToken = 'span.event__detail';
            $$(dateTimeToken).each((idx, elem) => {
                if (idx === 0) {            
                    var dateDashIdxs = [];
                    var dateStr = $(elem).text();
                    dateStr = dateStr.trim();
                    for (var i = 0; i < dateStr.length; i++) {
                        if (dateStr[i] === '–') {
                            dateDashIdxs.push(i);
                        }
                    }
                    if (dateDashIdxs.length === 1) {
                        startDate = dateStr.slice(0, dateDashIdxs[0]).trim()
                        endDate = dateStr.slice(dateDashIdxs[0] + 1).trim()
                    } else {
                        startDate = dateStr;
                        endDate = dateStr;
                    }
                }
                if (idx === 1) {
                    var dashIdx = -1;
                    var timeStr = $(elem).text();
                    timeStr = timeStr.trim();
                    dashIdx = timeStr.indexOf('–');
                    startTime = timeStr.slice(0, dashIdx);
                    startTime = timeStr.trim();
                    endTime = timeStr.slice(dashIdx + 1);
                    endTime = endTime.trim();
                }
            });
            const objWithStartDateMoment = moment(startDate, ['dddd, MMM. D, YYYY', 'dddd, MMM. DD, YYYY']);
            if (!objWithStartDateMoment.isValid()) {
                objAry[i]['start_date_uncertain'] = true;
            } else {
                objAry[i]['start_date_uncertain'] = false;
            }
            const objWithStartDate = objWithStartDateMoment.toDate();
            const objWithEndDateMoment = moment(endDate, ['dddd, MMM. D, YYYY', 'dddd, MMM. DD, YYYY']);
            if (!objWithEndDateMoment.isValid()) {
                objAry[i]['end_date_uncertain'] = true;
            } else {
                objAry[i]['end_date_uncertain'] = false;
            }
            const objWithEndDate = objWithEndDateMoment.toDate();
            const objWithStartTimeMoment = moment(startTime, ['hh:mm a', 'h:mm a']);
            if (!objWithStartTimeMoment.isValid()) {
                objAry[i]['start_time_uncertain'] = true;
            } else {
                objAry[i]['start_time_uncertain'] = false;
            }
            const objWithStartTime = objWithStartTimeMoment.toDate();
            const objWithEndTimeMoment = moment(endTime, ['hh:mm a', 'h:mm a']);
            if (!objWithEndTimeMoment.isValid()) {
                objAry[i]['end_time_uncertain'] = true;
            } else {
                objAry[i]['end_time_uncertain'] = false;
            }
            const objWithEndTime = objWithEndTimeMoment.toDate();
            objWithStartTime.setFullYear(objWithStartDate.getFullYear());
            objWithStartTime.setMonth(objWithStartDate.getMonth());
            objWithStartTime.setDate(objWithStartDate.getDate());
            objWithEndTime.setFullYear(objWithEndDate.getFullYear());
            objWithEndTime.setMonth(objWithEndDate.getMonth());
            objWithEndTime.setDate(objWithEndDate.getDate());
            try {
                objAry[i]['start_time'] = admin.firestore.Timestamp.fromDate(new Date(objWithStartTime));
                objAry[i]['end_time'] = admin.firestore.Timestamp.fromDate(new Date(objWithEndTime));
            } catch(e) {
                objAry[i]['start_time'] = admin.firestore.Timestamp.fromDate(new Date());
                objAry[i]['end_time'] = admin.firestore.Timestamp.fromDate(new Date());
            }

            
            // Scrape description & add summary
            const descriptionToken = '[class="l-main"]';
            str = '';
            $$(descriptionToken).each((idx, elem) => {
                let str = $(elem).find('p').text();
                str = str.trim();
                if (str.length > 1997) {
                    objAry[i]['description'] = str.slice(0, 1998) + '...';
                } else {
                    objAry[i]['description'] = str;
                }
                objAry[i]['summary'] = str.slice(0, Math.min(str.length, 140));      // Follow twitter rules plz
            });


            // Set time updated
            objAry[i]['time_updated'] = admin.firestore.Timestamp.fromDate(new Date());
            // Set update note
            objAry[i]['updates'] = "Re-scraped from the university website";
            

            return;
        }).catch((e) => {
            console.log("ERROR SCRAPING FROM DETAIL PAGE: " + e);
        });
    }

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
    return {
        documents: objAry,
        documentIds: idAry
    };
}
