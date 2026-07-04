var createError = require("http-errors");
var express = require("express");
var path = require("path");
var cookieParser = require("cookie-parser");
var cors = require("cors");
var compression = require("compression");
var nocache = require("nocache");
var bodyParser = require("body-parser");
require("dotenv").config();
var fs = require("fs");
var http = require("http");
var https = require("https");

// ----------------------------------------------------
// ENVIRONMENT DB SETUP
// ----------------------------------------------------
if (process.env.STAGE === "PROD") {
    global.tally_db_name = process.env.DB_OAKTER_TALLY_DBNAME;
    global.ims_db_name = process.env.DB_OAKTER_INVT_DBNAME;
    global.other_db_name = process.env.DB_OAKTER_OTHER_DBNAME;
} else {
    global.tally_db_name = process.env.TEST_OAKTER_TALLY_DBNAME;
    global.ims_db_name = process.env.TEST_OAKTER_INVT_DBNAME;
    global.other_db_name = process.env.TEST_OAKTER_OTHER_DBNAME;
}

// ----------------------------------------------------
// GLOBAL UTILITIES
// ----------------------------------------------------
global.helper = require("./helper/helper");
global.moment = require("moment-timezone");

console.log("Starting the application...");
var app = express();

// ----------------------------------------------------
// MIDDLEWARES
// ----------------------------------------------------
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "jade");

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(compression());
app.use(nocache());

app.use(
    cors({
        origin: "*",
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    })
);
// Save Payloads and Response of the API Requests directly to database
const activityLog = require("./middleware/activityLog");

app.use(activityLog);
// ----------------------------------------------------
// ROUTES
// ----------------------------------------------------
require("./routes/router")(app);

// ----------------------------------------------------
// ERROR HANDLERS
// ----------------------------------------------------
app.use(function (req, res, next) {
    return res
        .status(404)
        .send(require("./helper/backendProcess/error_404").error_404());
});

app.use(function (err, req, res, next) {
    res.locals.message = err.message;
    res.locals.error = req.app.get("env") === "development" ? err : {};
    res.status(err.status || 500);
    res.render("error");
});

// ----------------------------------------------------
// 🚀 HTTP SERVER (API ONLY)
// ----------------------------------------------------
const API_PORT = process.env.PORT;
const httpServer = http.createServer(app);

httpServer.listen(API_PORT, () => {
    console.log(`🚀 HTTP API running on port ${API_PORT}`);
});

// ----------------------------------------------------
// 🔐 HTTPS SOCKET.IO SERVER (SOCKET ONLY – 3001)
// ----------------------------------------------------
const https_options = {
    key: fs.readFileSync("./certificate/private.key"),
    cert: fs.readFileSync("./certificate/certificate.crt"),
    ca: fs.readFileSync("./certificate/ca_bundle.crt"),
};

const httpsSocketServer = https.createServer(https_options);

const { Server } = require("socket.io");
const io = new Server(httpsSocketServer, {
    cors: { origin: "*" },
    pingInterval: 20000,
    pingTimeout: 20000,
});

require("./SOCKET/router")(io);

const SOCKET_PORT = process.env.SOCKET_PORT;
httpsSocketServer.listen(SOCKET_PORT, () => {
    console.log(`🔐 HTTPS Socket.IO running on port ${SOCKET_PORT}`);
});

// ----------------------------------------------------
// 🛡️ SAFETY (PREVENT FULL CRASH)
// ----------------------------------------------------
process.on("uncaughtException", (err) => {
    console.error("❌ Uncaught Exception:", err);
});

process.on("unhandledRejection", (reason) => {
    console.error("❌ Unhandled Rejection:", reason);
});

module.exports = app;