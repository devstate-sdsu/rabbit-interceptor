const request = require("request-promise");
const cheerio = require("cheerio");
const URL = require("url-parse");
const admin = require("firebase-admin");
const moment = require("moment");
var schedule = require('node-schedule');

admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    databaseURL: 'https://rabbitbums.firebaseio.com'
});

let db = admin.firestore();

//var j = schedule.scheduleJob({hour: 0, minute: 0, dayOfWeek: 0}, function(){
var j = schedule.scheduleJob({second: 0}, function(){
	scrapeFromMainPage().then((res) => {
		res.forEach((event) => {
			db.collection('abcServicesCol').add(event).then(ref => {
				console.log('Added document with ID: ', ref.id);
			}).catch(e => {
				console.log("ERROR WITH FIRESTORE: " + e);
			});
		});
	})
});

async function scrapeFromMainPage() {
    const base = "https://www.sdstate.edu/wellness-center/hours-operation";
    let masterAry = [];
    masterAry = collectEventsPromise(base, masterAry);
    return masterAry;
}

async function collectEventsPromise(base, masterAry) {
    return new Promise((resolve, reject) => {
        request(base).then((body) => {
            let $ = cheerio.load(body);
            collectEvents($).then((result) => {
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


async function collectEvents($) {
	const daterange = '.l-main>h2';
	const objAry = [];
	let i, temp = 0;
	let tableCount = 0;

	$(daterange).each((idx, elem) => {
		let date_str = $(elem).text();
		const dashIdx = date_str.indexOf('-');
		const commaIdx = date_str.indexOf(',');
		let startDate = new Date(date_str.slice(0, dashIdx - 1));
		let endDate = new Date (date_str.slice(dashIdx + 2, commaIdx));
		const year = date_str.slice(commaIdx + 2, commaIdx + 6);
		
		startDate.setFullYear(year);
		endDate.setFullYear(year);
		const today = moment().format('YYYY-MM-DD');

		startDate = moment(startDate).format('YYYY-MM-DD');
		endDate = moment(endDate).format('YYYY-MM-DD');

		if(moment(today).isSame(startDate) || (moment(today).isAfter(startDate) && moment(today).isBefore(endDate))) {
			i = temp;
			const newObj = {};
			newObj['name'] = 'Wellness Center';
			objAry.push(newObj);
		}
		temp += 49;
	});
	
	objAry[tableCount].email = 'sdsu.wellnesscenter@sdstate.edu';
	objAry[tableCount].phoneNumber = '605-697-9355';
	
	const times = '.l-main>table>tbody>tr>td';
	let j = i + 7;
	objAry[tableCount].day = {};
	for(i; i < j; i++) {
		let time_str = $(times).slice(i).eq(0).text();
		const dashIdx = time_str.indexOf('-');
		const startTime = time_str.slice(0, dashIdx);
		const endTime = time_str.slice(dashIdx + 1);
		let z = i % 7;
		switch(z) {
			case 0:
				objAry[tableCount].day.Sunday = {};
				objAry[tableCount].day.Sunday['open'] = startTime;
				objAry[tableCount].day.Sunday['closed'] = endTime;					
				break;
			case 1:
				objAry[tableCount].day.Monday = {};
				objAry[tableCount].day.Monday['open'] = startTime;
				objAry[tableCount].day.Monday['closed'] = endTime;	
				break;
			case 2:
				objAry[tableCount].day.Tuesday = {};
				objAry[tableCount].day.Tuesday['open'] = startTime;
				objAry[tableCount].day.Tuesday['closed'] = endTime;	
				break;
			case 3:
				objAry[tableCount].day.Wednesday = {};
				objAry[tableCount].day.Wednesday['open'] = startTime;
				objAry[tableCount].day.Wednesday['closed'] = endTime;	
				break;
			case 4:
				objAry[tableCount].day.Thursday = {};
				objAry[tableCount].day.Thursday['open'] = startTime;
				objAry[tableCount].day.Thursday['closed'] = endTime;	
				break;
			case 5:
				objAry[tableCount].day.Friday = {};
				objAry[tableCount].day.Friday['open'] = startTime;
				objAry[tableCount].day.Friday['closed'] = endTime;	
				break;
			case 6:
				objAry[tableCount].day.Saturday = {};
				objAry[tableCount].day.Saturday['open'] = startTime;
				objAry[tableCount].day.Saturday['closed'] = endTime;	
				break;
			default:
				console.log('Error');
			}
		}

	console.log(objAry);

	return objAry;

}