const { google } = require("googleapis");
const MailComposer = require("nodemailer/lib/mail-composer");

require("dotenv").config();

// const credentials = require("./credentials.json");
const tokens = require("../token.json");

const getGmailService = () => {
  //   const { client_secret, client_id, redirect_uris } = credentials.web;

  // console.log(process.env.client_id, process.env.client_secret, process.env.redirect_uris);

  const oAuth2Client = new google.auth.OAuth2(process.env.client_id, process.env.client_secret, process.env.redirect_uris);
  oAuth2Client.setCredentials(tokens);
  const gmail = google.gmail({ version: "v1", auth: oAuth2Client });
  return gmail;
};

const encodeMessage = (message) => {
  return Buffer.from(message).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const createMail = async (options) => {
  const mailComposer = new MailComposer(options);
  const message = await mailComposer.compile().build();
  return encodeMessage(message);
};

const replyMail = async (options) => {
  const gmail = getGmailService();
  const rawMessage = await createMail(options.options);
  const { data: { id } = {} } = await gmail.users.messages.send({
    userId: "me",
    resource: {
      raw: rawMessage,
      threadId: options.threadId,
    },
  });
  return id;
};

module.exports = replyMail;
