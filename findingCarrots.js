/*** 
 * Welcome to Rabbit Interceptor.
 * We are a highly technical scraper service, a provider of 
 * precision scraping of the SDState.edu events listings. 
 * We are currently deployed to Heroku. Heroku Scheduler 
 * executes "node findingCarrots.js" every day at 12:30 a.m..
 * The way you update the deployment that's on Heroku
 * is by updating the master branch on our devstate-sdsu
 * rabbit-interceptor repo. This can be done by either
 * pushing directly to master branch, or by making a
 * pull request.
 */


const request = require("request-promise");
const cheerio = require("cheerio");
const URL = require("url-parse");
const firebase = require("firebase");
const momentTz = require("moment-timezone");
var schedule = require('node-schedule');
var http = require('http');

// Variables vary according to whether we are testing or not
var { testing } = require('./config');
const eventsCollectionName = testing ? 'testEventsCol' : 'eventsCol';
const pagesToScrape = testing ? 3 : 20;

// This configuration is closely tied to how things are set up 
// in Heroku. In Heroku, we could add environment variables for an
// app. This means that we do not have to explicitly enter it 
// below, and that we also do not need a separate file to store
// the env vars.
var firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    databaseURL: process.env.FIREBASE_DATABASE_URL,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

let db = firebase.firestore();

/* MAIN FUNCTION */
// The following http.createServer function is called is to prevent heroku 
// from crashing for not listening to port.
// If you'd like to see what happens when you remove it, you can do so
// and then check heroku logs.
let server = http.createServer(
    function (req, res) { 
        res.writeHead(200, {'Content-Type': 'text/plain'}); 
        res.end('the rabbit-interceptor is intercepting all the carrots sent by the mojojosdstate'); })
            .listen(process.env.PORT || 5000);
scrapeFromMainPage()
    .then((res) => {
        let batch = db.batch();
        for (let i = 0; i < res.documents.length; i++) {
            event = res.documents[i];
            id = res.documentIds[i];
            let docRef = db.collection(eventsCollectionName).doc(id);
            batch.set(docRef, event);
        }
        batch.commit().then(() => {
            console.log("OH YES ADDING/UPDATING EVENTS WORKED")
            server.close();
            return("SUCCESS");
        }).catch(e => {
            console.log("Error batch committing document adding/updating");
            server.close();
            return("Error adding/updating events");
        });
    }).catch((e) => {
        console.log("Error scraping from main page" + e);
        server.close();
        return("Error scraping events");
    });
/* MAIN FUNCTION ENDS */


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
    // Every single *event* entry that's been added to the database by the scraper is 
    // formatted in UTC. But not in the way you would intuitively think.
    // For example, 8:00AM UTC-6 (Brookings time without Daylight Savings) will be
    // stored as 8:00AM UTC. Also, 8:00AM UTC-5 (Brookings time with Daylight Savings)
    // will also be stored as 8:00AM UTC. 
    // We are not storing in local time to prevent htis one scenario: Imagine a weekly recurring event,
    // that goes from 4-5pm. In our All Events listing, users will see multiple events.
    // Let's say we're in March and DST starts on March 8. The listings that come 
    // before March 8 will be displayed as 4-5pm. However, the listings that come
    // after March 8 will be displayed as 5-6pm. We don't want that! 
    // So, in the server we store as UTC, and in our app we display it as UTC. 
    console.log("Expiry time: ");
    console.log(firebase.firestore.Timestamp.fromDate(momentTz.utc("00:30", "HH:mm").toDate()));
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
        .where('end_time', '<', firebase.firestore.Timestamp.fromDate(momentTz.utc("00:30", "HH:mm").toDate()))
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

async function scrapeFromMainPage() {

    // At first, we assume every document needs to be removed.
    // After the scraper runs, we remove the documents that still exist
    // from this list of documents to be removed. So what's left in the
    // list are the ids of events that have been removed from the SDState website.
    const idsRemovedFromSite = new Set();
    await getAllDocumentIds(idsRemovedFromSite);
    const base = "https://www.sdstate.edu/events/list?department=All&title=&page=";

    // Separating masterObj into documents to store only the necessary event fields,
    // and into documentIds to store the documentIds. 
    // Because we don't want to store documentId as a field, but as a documentId
    // instead. 
    let masterObj = {};
    masterObj['documents'] = [];
    masterObj['documentIds'] = [];
    for (let i = 0; i < pagesToScrape; i++) {
        // The following line is to ensure eslint does not throw an error
        /* eslint-disable no-await-in-loop */
        const pageToVisit = base + i.toString();
        console.log("Visiting page: ", pageToVisit);
        masterObj = await collectEventsPromise(pageToVisit, masterObj, i);
    }
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
        // Possibly could make scraper faster by changing the following
        // await inside a for loop to a Promise.all() thingy. 
        await request(url)
        .then((body) => {
            let $$ = cheerio.load(body);

            // Scrape location
            // Possible location formats: 
            // Off-Campus , Georgia Morse Middle School in Pierre, SD
            // Pugsley Center , 105
            // On-Campus
            // Agricultural Heritage Museum
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
            // Possible date formats:
            // Saturday, Mar. 14, 2020
            // Monday, Mar. 9, 2020 – Monday, Apr. 27, 2020
            // Possible time formats:
            // 10:00 am – 1:00 pm
            // All-Day
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
                    if (dashIdx == -1) {
                        dashIdx = timeStr.indexOf('-');
                    }
                    startTime = timeStr.slice(0, dashIdx);
                    startTime = startTime.trim();
                    endTime = timeStr.slice(dashIdx + 1);
                    endTime = endTime.trim();
                }
            });

            // NOTE ONE
            // We are using UTC throughout this scraper because if we use exact, accurate-to-our-timezone time, 
            // some recurring events that happen at the same time every week will appear to happen at different
            // times this week than next week if this weekend is the beginning/end of Daylight Savings Time. 
            // NOTE TWO
            // You will see a two representations of the start/end date/time below.
            // The first is a Moment object. And the second is a Javascript Date object. 
            // We are using Moment because it parses dates better, and has useful functions.
            // Then we convert to Date because firebase firestore has a Timestamp method that converts
            // Date to firestore Timestamp. 
            const objWithStartDateMoment = momentTz.utc(startDate, ['dddd, MMM. D, YYYY', 'dddd, MMM. DD, YYYY']);
            if (!objWithStartDateMoment.isValid()) {
                objAry[i]['start_date_uncertain'] = true;
            } else {
                objAry[i]['start_date_uncertain'] = false;
            }
            const objWithStartDate = objWithStartDateMoment.toDate();
            const objWithEndDateMoment = momentTz.utc(endDate, ['dddd, MMM. D, YYYY', 'dddd, MMM. DD, YYYY']);
            if (!objWithEndDateMoment.isValid()) {
                objAry[i]['end_date_uncertain'] = true;
            } else {
                objAry[i]['end_date_uncertain'] = false;
            }
            const objWithEndDate = objWithEndDateMoment.toDate();


            var objWithStartTime = new Date();
            var objWithEndTime = new Date();
            if (startTime === 'All' && endTime === 'Day') {
                objAry[i]['start_time_uncertain'] = false;
                objAry[i]['end_time_uncertain'] = false;
                objWithStartTime.setHours(0, 0, 0, 0);
                objWithEndTime.setHours(23, 59, 59, 999);
            } else {
                const objWithStartTimeMoment = momentTz.utc(startTime, ['hh:mm a', 'h:mm a']);
                if (!objWithStartTimeMoment.isValid()) {
                    objAry[i]['start_time_uncertain'] = true;
                } else {
                    objAry[i]['start_time_uncertain'] = false;
                }            
                objWithStartTime = objWithStartTimeMoment.toDate();
                const objWithEndTimeMoment = momentTz.utc(endTime, ['hh:mm a', 'h:mm a']);
                if (!objWithEndTimeMoment.isValid()) {
                    objAry[i]['end_time_uncertain'] = true;
                } else {
                    objAry[i]['end_time_uncertain'] = false;
                }
                objWithEndTime = objWithEndTimeMoment.toDate();
                objWithStartTime.setFullYear(objWithStartDate.getFullYear());
                objWithStartTime.setMonth(objWithStartDate.getMonth());
                objWithStartTime.setDate(objWithStartDate.getDate());
                objWithEndTime.setFullYear(objWithEndDate.getFullYear());
                objWithEndTime.setMonth(objWithEndDate.getMonth());
                objWithEndTime.setDate(objWithEndDate.getDate());
            }
            
            try {
                objAry[i]['start_time'] = firebase.firestore.Timestamp.fromDate(new Date(objWithStartTime));
                objAry[i]['end_time'] = firebase.firestore.Timestamp.fromDate(new Date(objWithEndTime));
            } catch(e) {
                objAry[i]['start_time'] = firebase.firestore.Timestamp.fromDate(new Date());
                objAry[i]['end_time'] = firebase.firestore.Timestamp.fromDate(new Date());
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
            objAry[i]['time_updated'] = firebase.firestore.Timestamp.fromDate(new Date());
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
            if (str.startsWith('/sites/default/files/styles/teaser_image_/public/2018-12/Logo_37.jpg') || 
                str.startsWith('/sites/default/files/styles/teaser_image_/public/2019-09/jacks%20Logo_0.jpg' ||
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


