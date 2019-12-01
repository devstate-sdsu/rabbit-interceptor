const request = require("request");
const cheerio = require("cheerio");
const URL = require("url-parse");
const admin = require("firebase-admin");
const moment = require("moment");

const pageToVisit = "https://www.sdstate.edu/events/list";
console.log("Visiting page: ", pageToVisit);
request(pageToVisit, function(error, response, body) {
   if (error) {
       console.log("Error: " + error);
   }
    console.log("Status code: " + response.statusCode);
   if (response.statusCode == 200) {
       // Parse the document body
       var $ = cheerio.load(body);
       console.log("Page title: " + $('title').text());
       collectEvents($);
   }
});

function collectEvents($) {
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
        const objWithStartTime = moment(startTime, ['h:m a']).toDate();
        const objWithEndTime = moment(endTime, ['h:m a']).toDate();
        const newStartTime = objWithDate.setTime(objWithStartTime.getTime());
        const newEndTime = objWithDate.setTime(objWithEndTime.getTime());

        objAry[idx]['time'] = []
        objAry[idx]['time'].push(admin.firestore.Timestamp.fromDate(new Date(newStartTime)));
        objAry[idx]['time'].push(admin.firestore.Timestamp.fromDate(new Date(newEndTime)));
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

    console.log(">>> RESULT: ");
    console.log(objAry);
}
