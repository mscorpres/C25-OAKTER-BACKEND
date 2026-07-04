const cron = require("node-cron");
const { otherDB, invtDB } = require("../config/db/connection");
const fs = require("fs");

async function start() {
  try {
    const readLogFile = fs.readFileSync("./middleware/json_access.log");

    // READ LINES AND CONVERT TO JSON
    const lines = readLogFile.toString().split("\n");

    let bulkData = [];

    for (let i = 0; i < lines.length - 1; i++) {
      const json = JSON.parse(lines[i]);
      bulkData.push({
        ip: json.ip,
        log_id: json.log_id,
        method: json.method,
        path: json.url,
        status: json.status,
        timestamp: json.timestamp,
        responseTime: json.responseTime,
        userAgent: json.userAgent,
        userid: json.userid,
        requestBody: JSON.stringify(json.requestBody),
        responseBody: JSON.stringify(json.responseBody),
      });
    }

    if (bulkData.length > 0) {
      await otherDB.getQueryInterface().bulkInsert("req_activity_log", bulkData, { ignoreDuplicates: true });
    }

    // EMPTY LOG FILE
    fs.writeFileSync("./middleware/json_access.log", "");
  } catch (e) {
    console.log(e);
  }
}

// 12 AM
// cron.schedule("0 0 12 * * *", start);
// TEST
cron.schedule("0 * * * * *", start);

// var route, routes = [];
// app._router.stack.forEach(function(middleware){
//   if(middleware.route){ // routes registered directly on the app
//       routes.push(middleware.route);
//   } else if(middleware.name === 'router'){ // router middleware
//       middleware.handle.stack.forEach(function(handler){
//           route = handler.route;
//           route && routes.push(route);
//       });
//   }
// });

// console.log(routes.length);
