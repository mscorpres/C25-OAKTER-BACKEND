const { google } = require("googleapis");

require("dotenv").config();

// const credentials = require("./credentials.json");
const tokens = require("../token.json");

exports.getGmailService = () => {
  const oAuth2Client = new google.auth.OAuth2(process.env.client_id, process.env.client_secret, process.env.redirect_uris);
  oAuth2Client.setCredentials(tokens);
  const gmail = google.gmail({ version: "v1", auth: oAuth2Client });
  return gmail;
};
