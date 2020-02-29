const momentTz = require("moment-timezone");


console.log(momentTz.tz(momentTz(), "America/North_Dakota/Center").utcOffset());