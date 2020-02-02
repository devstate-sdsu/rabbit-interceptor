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
// var j = schedule.scheduleJob({second: 0}, function(){
	scrapeFromMainPage().then((res) => {
		res.forEach((event) => {
			db.collection('abcServicesCol').add(event).then(ref => {
				console.log('Added document with ID: ', ref.id);
			}).catch(e => {
				console.log("ERROR WITH FIRESTORE: " + e);
			});
		});
	});
// });

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
	const startDateStrAry = [];
	const intYearAry = [];

	$(daterange).each((idx, elem) => {
		let date_str = $(elem).text();
		const dashIdx = date_str.indexOf('-');
		const commaIdx = date_str.indexOf(',');
		startDateStrAry.push(date_str.slice(0, dashIdx).trim());
		const year = date_str.slice(commaIdx + 1, commaIdx + 6).trim();
		const intYear = parseInt(year);
		intYearAry.push(intYear);
	});

	for (let idx = 0; idx < startDateStrAry.length; idx++) {
		let startDateStr = startDateStrAry[idx];
		let startDate = moment(startDateStr, ['MMMM D']);
		if (!startDate.isValid()) {
			break;
		}
		startDate.set('year', intYearAry[idx]);
		let endDate = startDate.add(6, 'days');
		const today = moment();
		if(today.isSame(startDate) || (today.isAfter(startDate) && today.isBefore(endDate.add(1, 'days')))) {
			i = temp;
		}
		// Incrementing by 49 because each week has 49 sets of hours, with 7 of them being facility hours.
		temp += 49;
	}
	
	objAry.push({});
	objAry[tableCount].name = 'Wellness Center Main Facility';
	objAry[tableCount].mainInfo = 'The Wellness Center is dedicated to supporting academic success and ' +
		'personal development by promoting and encouraging a healthy lifestyle for the members of the ' + 
		'SDSU community. The Wellness Center houses state of the art fitness equipment, a variety of ' + 
		'recreational and intramural programs, effective wellness education, and a student health clinic' + 
		'and counseling services.';
	objAry[tableCount].summary = 'The Wellness Center is dedicated to supporting academic success and ' +
		'personal development by promoting and encouraging a healthy lifestyle for the members of the ' + 
		'SDSU community.';
	objAry[tableCount].email = 'sdsu.wellnesscenter@sdstate.edu';
	objAry[tableCount].phoneNumber = '605-697-9355';
	objAry[tableCount].bigLocation = 'Wellness Center';
	objAry[tableCount].tinyLocation = '';
	objAry[tableCount].image = 'https://www.sdstate.edu/sites/default/files/2019-01/FitandRecHighRes.jpg';
	objAry[tableCount].hours = [{
		name: 'Regular',
		days: []
	}];
	
	
	const times = '.l-main>table>tbody>tr>td';
	let j = i + 7;
	console.log(">>> THIS IS I: ", i);
	console.log(">>> THIS IS J: ", j);
	for(i; i < j; i++) {
		let time_str = $(times).slice(i).eq(0).text();
		const dashIdx = time_str.indexOf('-');
		const startTime = time_str.slice(0, dashIdx).trim();
		const endTime = time_str.slice(dashIdx + 1).trim();
		let z = i % 7;
		switch(z) {
			case 0:
				objAry[tableCount].hours[0].days.push({
					day: 'Sunday',
					hours: []
				});
				objAry[tableCount].hours[0].days[0].hours = {};
				objAry[tableCount].hours[0].days[0].hours['open'] = startTime;
				objAry[tableCount].hours[0].days[0].hours['closed'] = endTime;
				break;
			case 1:
				objAry[tableCount].hours[0].days.push({
					day: 'Monday',
					hours: []
				});
				objAry[tableCount].hours[0].days[1].hours = {};
				objAry[tableCount].hours[0].days[1].hours['open'] = startTime;
				objAry[tableCount].hours[0].days[1].hours['closed'] = endTime;
				break;
			case 2:
				objAry[tableCount].hours[0].days.push({
					day: 'Tuesday',
					hours: []
				});
				objAry[tableCount].hours[0].days[2].hours = {};
				objAry[tableCount].hours[0].days[2].hours['open'] = startTime;
				objAry[tableCount].hours[0].days[2].hours['closed'] = endTime;
				break;
			case 3:
				objAry[tableCount].hours[0].days.push({
					day: 'Wednesday',
					hours: []
				});
				objAry[tableCount].hours[0].days[3].hours = {};
				objAry[tableCount].hours[0].days[3].hours['open'] = startTime;
				objAry[tableCount].hours[0].days[3].hours['closed'] = endTime;
				break;
			case 4:
				objAry[tableCount].hours[0].days.push({
					day: 'Thursday',
					hours: []
				});
				objAry[tableCount].hours[0].days[4].hours = {};
				objAry[tableCount].hours[0].days[4].hours['open'] = startTime;
				objAry[tableCount].hours[0].days[4].hours['closed'] = endTime;
				break;
			case 5:
				objAry[tableCount].hours[0].days.push({
					day: 'Friday',
					hours: []
				});
				objAry[tableCount].hours[0].days[5].hours = {};
				objAry[tableCount].hours[0].days[5].hours['open'] = startTime;
				objAry[tableCount].hours[0].days[5].hours['closed'] = endTime;	
				break;
			case 6:
				objAry[tableCount].hours[0].days.push({
					day: 'Saturday',
					hours: []
				});
				objAry[tableCount].hours[0].days[6].hours = {};
				objAry[tableCount].hours[0].days[6].hours['open'] = startTime;
				objAry[tableCount].hours[0].days[6].hours['closed'] = endTime;
				break;
			default:
				console.log('Error');
			}
		}

	console.log(objAry);

	return objAry;

}