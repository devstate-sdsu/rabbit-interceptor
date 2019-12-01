const request = require("request-promise");
const cheerio = require("cheerio");
const URL = require("url-parse");
const admin = require("firebase-admin");
const moment = require("moment");


main().then((res) => console.log("THIS IS RESULT: ", res));

async function main() {
    const base = "https://www.sdstate.edu/events/list?department=All&title=&page=";
    let masterAry = [];
    for (let i = 0; i < 11 ; i++) {
        const pageToVisit = base + i.toString();
        console.log("Visiting page: ", pageToVisit);
        await request(pageToVisit, function(error, response, body) {
            if (error) {
                console.log("Error: " + error);
            }
            console.log("Status code: " + response.statusCode);
            if (response.statusCode == 200) {
                // Parse the document body
                let $ = cheerio.load(body);
                console.log("Page title: " + $('title').text());
                const aryFromPage = collectEvents($);
                if (aryFromPage.length === 0) {
                    return;
                } else {
                    masterAry = masterAry.concat(aryFromPage);
                }
            }
        });
    }
    return masterAry;
}

function collectEvents($, baseYear) {
    const objAry = [];

    // Scrape title
    const titleToken = '.featured-list-item__title>a';
    $(titleToken).each((idx, elem) => {
        const newObj = {};
        let str = $(elem).text();
        str = str.trim();
        newObj['name'] = str;
        objAry.push(newObj);
    });

    // Scrape description
    const descriptionToken = 'div.featured-list-item__content:has(h3.featured-list-item__title)';
    $(descriptionToken).each((idx, elem) => {
        let str = $(elem).find('p').text();
        str = str.trim();
        objAry[idx]['description'] = str;
    });

    // Scrape location
    const locationToken = 'div.featured-list-item__content:has(h3.featured-list-item__title)';
    $(locationToken).each((idx, elem) => {
        let str = $(elem).find('span.metadata--event').slice(1).text();
        str = str.trim();
        objAry[idx]['location'] = str;
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
        const objWithStartTime = moment(startTime, ['hh:mm a', 'h:mm a']).toDate();
        const objWithEndTime = moment(endTime, ['hh:mm a', 'h:mm a']).toDate();
        const newStartTime = objWithDate.setTime(objWithStartTime.getTime());
        const newEndTime = objWithDate.setTime(objWithEndTime.getTime());

        objAry[idx]['time'] = []
        try {
            objAry[idx]['time'].push(admin.firestore.Timestamp.fromDate(new Date(newStartTime)));
            objAry[idx]['time'].push(admin.firestore.Timestamp.fromDate(new Date(newEndTime)));
        } catch {
            objAry[idx]['time'].push(admin.firestore.Timestamp.fromDate(new Date()));
            objAry[idx]['time'].push(admin.firestore.Timestamp.fromDate(new Date()));
        }
        // Set time updated
        objAry[idx]['time_updated'] = admin.firestore.Timestamp.fromDate(new Date());
        // Set update note
        objAry[idx]['updates'] = "Re-scraped from the university website";
    });

    // Scrape img url
    const imgToken = 'li.featured-list-item:has(h3.featured-list-item__title)';
    console.log("IMG TOKEN LENGTH: ", $(imgToken).length);
    $(imgToken).each((idx, elem) => {
        console.log("ARE WE HERE");
        let str = $(elem).find('img.b-lazy').attr('data-src');
        console.log(str);
        if (str) {
            str = str.trim();
            objAry[idx]['image'] = 'https://www.sdstate.edu' + str;
        } else {
            objAry[idx]['image'] = 'https://www.sdstate.edu/sites/default/files/images/Mon-19/Artboard%205%402x_1.png';
        }
    });
    return objAry;
}
