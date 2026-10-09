const moment = require("moment-timezone");
const { tallyDB } = require("../../config/db/connection");


const VBT_NUMBER_KEY = "FY";

const currentFySession = () => {
  const now = moment().tz("Asia/Kolkata");
  const startYear = now.month() >= 3 ? now.year() : now.year() - 1;
  return `${String(startYear).slice(-2)}${String(startYear + 1).slice(-2)}`;
};

const getNextVbtNumber = async (transaction) => {
  const session = currentFySession();

  const stmt_number = await tallyDB.query("SELECT * FROM `tally_numbering` WHERE `for_number` = :key FOR UPDATE", {
    replacements: { key: VBT_NUMBER_KEY },
    type: tallyDB.QueryTypes.SELECT,
    transaction,
  });

  if (stmt_number.length <= 0) {
    throw new Error(`Numbering not configured for ${VBT_NUMBER_KEY} in tally_numbering`);
  }

  const row = stmt_number[0];
  // New financial year → restart series from 0001
  const next = row.session == session ? parseInt(row.suffix) + 1 : 1;

  await tallyDB.query("UPDATE `tally_numbering` SET `session` = :session, `suffix` = :suffix WHERE `for_number` = :key", {
    replacements: { key: VBT_NUMBER_KEY, session, suffix: next },
    type: tallyDB.QueryTypes.UPDATE,
    transaction,
  });

  return `${row.prefix}/${session}/${String(next).padStart(parseInt(row.number_length_limit), "0")}`;
};

module.exports = { getNextVbtNumber };
