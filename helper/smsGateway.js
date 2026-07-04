require("dotenv").config();
const http = require("https");

const options = {
  method: "POST",
  hostname: "api.msg91.com",
  port: null,
  path: "/api/v5/flow/",
  headers: {
    authkey: "342390AEYUuylQ5b5fedd2d2",
    "content-type": "application/json",
  },
};

// Technical Issue
exports.technicalIssue = async function (mobile, app, time) {
  const req = http.request(options, function (res) {
    const chunks = [];
    res.on("data", function (chunk) {
      chunks.push(chunk);
    });
    res.on("end", function () {
      const body = Buffer.concat(chunks);
      console.log(body.toString());
    });
  });

  const str = `{\n  \"flow_id\": \"63d35b76d6fc05729e1a97c2\",\n  \"sender\": \"MSCORP\",\n  \"short_url\": \"0\",\n  \"mobiles\": \"${mobile}\",\n  \"app\": \"${app}\",\n  \"time\": \"${time}\"\n}`;

  req.write(str);
  req.end();
};

// Server Still Maintenance
exports.ServerStillMaintenance = async function (mobile, app, time) {
  const req = http.request(options, function (res) {
    const chunks = [];
    res.on("data", function (chunk) {
      chunks.push(chunk);
    });
    res.on("end", function () {
      const body = Buffer.concat(chunks);
      console.log(body.toString());
    });
  });

  const str = `{\n  \"flow_id\": \"63d35b31d6fc052494301f63\",\n  \"sender\": \"MSCORP\",\n  \"short_url\": \"0\",\n  \"mobiles\": \"${mobile}\",\n  \"app\": \"${app}\",\n  \"time\": \"${time}\"\n}`;

  req.write(str);
  req.end();
};

// Server Maintenance
exports.ServerMaintenance = async function (mobile, app, from, to) {
  const req = http.request(options, function (res) {
    const chunks = [];
    res.on("data", function (chunk) {
      chunks.push(chunk);
    });
    res.on("end", function () {
      const body = Buffer.concat(chunks);
      console.log(body.toString());
    });
  });

  const str = `{\n  \"flow_id\": \"63d35a9fd6fc05222410fa13\",\n  \"sender\": \"MSCORP\",\n  \"short_url\": \"0\",\n  \"mobiles\": \"${mobile}\",\n  \"app\": \"${app}\",\n  \"from\": \"${from}\",\n  \"to\": \"${to}\"\n}`;

  req.write(str);
  req.end();
};

// Account Created
exports.AccountCreated = async function (mobile, app, name, username, password, url) {
  const req = http.request(options, function (res) {
    const chunks = [];
    res.on("data", function (chunk) {
      chunks.push(chunk);
    });
    res.on("end", function () {
      const body = Buffer.concat(chunks);
      console.log(body.toString());
    });
  });

  const str = `{\n  \"flow_id\": \"63d35a49d6fc057311105e32\",\n  \"sender\": \"MSCORP\",\n  \"short_url\": \"0\",\n  \"mobiles\": \"${mobile}\",\n  \"app\": \"${app}\",\n  \"name\": \"${name}\",\n  \"username\": \"${username}\"\n,\n  \"password\": \"${password}\",\n  \"url\": \"${url}\"\n}`;

  req.write(str);
  req.end();
};

// Account Unsuspended
exports.AccountUnsuspended = async function (mobile, app, username) {
  const req = http.request(options, function (res) {
    const chunks = [];
    res.on("data", function (chunk) {
      chunks.push(chunk);
    });
    res.on("end", function () {
      const body = Buffer.concat(chunks);
      console.log(body.toString());
    });
  });

  const str = `{\n  \"flow_id\": \"63d359c8d6fc05271d13e6c2\",\n  \"sender\": \"MSCORP\",\n  \"short_url\": \"0\",\n  \"mobiles\": \"${mobile}\",\n  \"app\": \"${app}\",\n  \"username\": \"${username}\"\n}`;

  req.write(str);
  req.end();
};

// Change Password
exports.PasswordChange = async function (mobile, app, username) {
  const req = http.request(options, function (res) {
    const chunks = [];
    res.on("data", function (chunk) {
      chunks.push(chunk);
    });
    res.on("end", function () {
      const body = Buffer.concat(chunks);
      console.log(body.toString());
    });
  });

  const str = `{\n  \"flow_id\": \"63cf83f060ee8222996d2893\",\n  \"sender\": \"MSCORP\",\n  \"short_url\": \"0\",\n  \"mobiles\": \"${mobile}\",\n  \"app\": \"${app}\",\n  \"username\": \"${username}\",\n  \"email\": \"iot@mscorpres.in\"\n}`;

  req.write(str);
  req.end();
};

// Account Suspended
exports.AccountSuspended = async function (mobile, app, username) {
  const req = http.request(options, function (res) {
    const chunks = [];
    res.on("data", function (chunk) {
      chunks.push(chunk);
    });
    res.on("end", function () {
      const body = Buffer.concat(chunks);
      console.log(body.toString());
    });
  });

  const str = `{\n  \"flow_id\": \"63d3597cd6fc052b1a0524e2\",\n  \"sender\": \"MSCORP\",\n  \"short_url\": \"0\",\n  \"mobiles\": \"${mobile}\",\n  \"app\": \"${app}\",\n  \"username\": \"${username}\"\n}`;

  req.write(str);
  req.end();
};

// Change Mobile Number
exports.ChangeMobileNumber = async function (mobile, app, reference, storeview) {
  const req = http.request(options, function (res) {
    const chunks = [];
    res.on("data", function (chunk) {
      chunks.push(chunk);
    });
    res.on("end", function () {
      const body = Buffer.concat(chunks);
      console.log(body.toString());
    });
  });

  const str = `{\n  \"flow_id\": \"63cf82e50595e45427117cc3\",\n  \"sender\": \"MSCORP\",\n  \"short_url\": \"0\",\n  \"mobiles\": \"${mobile}\",\n  \"app\": \"${app}\",\n  \"reference\": \"${reference}\",\n  \"storeview\": \"${storeview}\"\n}`;

  req.write(str);
  req.end();
};

// Mobile Email Updated
exports.MobileEmailUpdates = async function (mobile, type, app, username, olddata, newdata) {
  const req = http.request(options, function (res) {
    const chunks = [];
    res.on("data", function (chunk) {
      chunks.push(chunk);
    });
    res.on("end", function () {
      const body = Buffer.concat(chunks);
      console.log(body.toString());
    });
  });

  const str = `{\n  \"flow_id\": \"63cf839c1d60ee70d2692126\",\n  \"sender\": \"MSCORP\",\n  \"short_url\": \"0\",\n  \"mobiles\": \"${mobile}\",\n  \"type\": \"${type}\",\n  \"app\": \"${app}\",\n  \"username\": \"${username}\",\n  \"olddata\": \"${olddata}\",\n  \"newdata\": \"${newdata}\"\n}`;

  req.write(str);
  req.end();
};

// Password Changed
exports.PasswordChanged = async function (mobile, username, email) {
  const req = http.request(options, function (res) {
    const chunks = [];
    res.on("data", function (chunk) {
      chunks.push(chunk);
    });
    res.on("end", function () {
      const body = Buffer.concat(chunks);
      console.log(body.toString());
    });
  });

  const str = `{\n  \"flow_id\": \"63cf825332c93b607e456d05\",\n  \"sender\": \"MSCORP\",\n  \"short_url\": \"0\",\n  \"mobiles\": \"${mobile}\",\n  \"username\": \"${username}\",\n  \"email\": \"${email}\"\n}`;

  req.write(str);
  req.end();
};

// LOGIN OTP
exports.loginOTP = async function (mobile, otp) {
  const req = http.request(options, function (res) {
    const chunks = [];
    res.on("data", function (chunk) {
      chunks.push(chunk);
    });
    res.on("end", function () {
      const body = Buffer.concat(chunks);
      console.log(body.toString());
    });
  });

  const str = `{\n  \"flow_id\": \"642f8c21d6fc05649423fd12\",\n  \"sender\": \"MSCORP\",\n  \"short_url\": \"0\",\n  \"mobiles\": \"${mobile}\",\n  \"var\": \"${otp}\",\n}`;

  req.write(str);
  req.end();
};
