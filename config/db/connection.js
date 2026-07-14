require("dotenv").config();
 
const { Sequelize } = require("sequelize");
 
let options = {
  multipleStatements: true,
  connectTimeout: 30000,
  connectionLimit: 10,
  waitForConnections: true,
  queueLimit: 0,
};
let poolOption = {
  max: 10,
  min: 0,
  idle: 5000, 
  acquire: 30000, 
  evict: 1000, 
  handleDisconnects: true, 
 
  logging: true, 
};
 
let other, invt, tally, invtOakter, otherOakter, tallyOakter;

async function testConnection(sequelize, name) {
  try {
    await sequelize.authenticate();
    console.log(`${name} DB connected successfully.`);
  } catch (err) {
    console.error(`${name} DB connection failed:`, err.message);
    setTimeout(() => testConnection(sequelize, name), 5000);
  }
}
 
if (process.env.STAGE == "PROD") {
  // PRIMARY: this project is c25, so invt/other/tally (exported as invtDB/otherDB/tallyDB,
  // used throughout the app) point at the c25 (Oakter) databases, using the dedicated
  // Oakter DB credentials.
  invt = new Sequelize(`${process.env.DB_OAKTER_INVT_DBNAME}`, `${process.env.DB_OAKTER_USER}`, `${process.env.DB_OAKTER_PASS}`, {
    host: `${process.env.DB_HOST}`,
    dialect: "mysql",
    dialectOptions: options,
    pool: poolOption, timezone: "+05:30"
  });

  other = new Sequelize(`${process.env.DB_OAKTER_OTHER_DBNAME}`, `${process.env.DB_OAKTER_USER}`, `${process.env.DB_OAKTER_PASS}`, {
    host: `${process.env.DB_HOST}`,
    dialect: "mysql",
    dialectOptions: options,
    pool: poolOption, timezone: "+05:30"
  });

  tally = new Sequelize(`${process.env.DB_OAKTER_TALLY_DBNAME}`, `${process.env.DB_OAKTER_USER}`, `${process.env.DB_OAKTER_PASS}`, {
    host: `${process.env.DB_HOST}`,
    dialect: "mysql",
    dialectOptions: options,
    pool: poolOption, timezone: "+05:30"
  });

  // SECONDARY: kept as *Oakter-named variables/exports (invtOakterDB, etc.) for backward
  // compatibility, but they now hold the Alwar connections, not Oakter.
  invtOakter = new Sequelize(`${process.env.DB_ALWAR_INVT_DBNAME}`, `${process.env.DB_USER}`, `${process.env.DB_PASS}`, {
    host: `${process.env.DB_HOST}`,
    dialect: "mysql",
    dialectOptions: options,
    pool: poolOption, timezone: "+05:30"
  });

  otherOakter = new Sequelize(`${process.env.DB_ALWAR_OTHER_DBNAME}`, `${process.env.DB_USER}`, `${process.env.DB_PASS}`, {
    host: `${process.env.DB_HOST}`,
    dialect: "mysql",
    dialectOptions: options,
    pool: poolOption, timezone: "+05:30"
  });

  tallyOakter = new Sequelize(`${process.env.DB_ALWAR_TALLY_DBNAME}`, `${process.env.DB_USER}`, `${process.env.DB_PASS}`, {
    host: `${process.env.DB_HOST}`,
    dialect: "mysql",
    dialectOptions: options,
    pool: poolOption, timezone: "+05:30"
  });

  const commonConfig = {
    host: process.env.DB_INVT_HOST,
    dialect: "mysql",
    dialectOptions: options,
    pool: poolOption,
    timezone: "+05:30",
    logging: true // set true only for debugging
  };

  invtC25 = new Sequelize(
    process.env.DB_C25_INVT_DBNAME,
    process.env.DB_USER,
    process.env.DB_PASS,
    commonConfig,
  );

  otherC25 = new Sequelize(
    process.env.DB_C25_OTHER_DBNAME,
    process.env.DB_USER,
    process.env.DB_PASS,
    commonConfig,
  );

  tallyC25 = new Sequelize(
    process.env.DB_C25_TALLY_DBNAME,
    process.env.DB_INVT_USER,
    process.env.DB_PASS,
    commonConfig,
  );

} else {
  // DEV/TEST mode - use TEST credentials for dev DBs
  // PRIMARY: c25 (Oakter) test databases, same as PROD above.
  const devHost = process.env.TEST_DB_HOST;
  const devUser = process.env.TEST_DB_USER;
  const devPass = process.env.TEST_DB_PASS;

  invt = new Sequelize(process.env.TEST_OAKTER_INVT_DBNAME, devUser, devPass, {
    host: devHost,
    dialect: "mysql",
    dialectOptions: options,
    pool: poolOption, timezone: "+05:30"
  });

  other = new Sequelize(process.env.TEST_OAKTER_OTHER_DBNAME, devUser, devPass, {
    host: devHost,
    dialect: "mysql",
    dialectOptions: options,
    pool: poolOption, timezone: "+05:30"
  });

  tally = new Sequelize(process.env.TEST_OAKTER_TALLY_DBNAME, devUser, devPass, {
    host: devHost,
    dialect: "mysql",
    dialectOptions: options,
    pool: poolOption, timezone: "+05:30"
  });

  // SECONDARY: Alwar test databases (see PROD block above for the naming note).
  invtOakter = new Sequelize(process.env.TEST_ALWAR_INVT_DBNAME, devUser, devPass, {
    host: devHost,
    dialect: "mysql",
    dialectOptions: options,
    pool: poolOption, timezone: "+05:30"
  });

  otherOakter = new Sequelize(process.env.TEST_ALWAR_OTHER_DBNAME, devUser, devPass, {
    host: devHost,
    dialect: "mysql",
    dialectOptions: options,
    pool: poolOption, timezone: "+05:30"
  });

  tallyOakter = new Sequelize(process.env.TEST_ALWAR_TALLY_DBNAME, devUser, devPass, {
    host: devHost,
    dialect: "mysql",
    dialectOptions: options,
    pool: poolOption, timezone: "+05:30"
  });

    invtC25 = new Sequelize(
    process.env.TEST_DB_C25_INVT_DBNAME,
    devUser,
    devPass,
    {
      host: devHost,
      dialect: "mysql",
      dialectOptions: options,
      pool: poolOption,
      timezone: "+05:30",
    },
  );

  otherC25 = new Sequelize(
    process.env.TEST_DB_C25_OTHER_DBNAME,
    devUser,
    devPass,
    {
      host: devHost,
      dialect: "mysql",
      dialectOptions: options,
      pool: poolOption,
      timezone: "+05:30",
    },
  );

  tallyC25 = new Sequelize(
    process.env.TEST_DB_C25_TALLY_DBNAME,
    devUser,
    devPass,
    {
      host: devHost,
      dialect: "mysql",
      dialectOptions: options,
      pool: poolOption,
      timezone: "+05:30",
    },
  );

}
 
 
(async () => {
  console.warn("Stage: " + process.env.STAGE);
  console.warn("=====CONNECTION CHECK STARTED======");
  await Promise.all([
    testConnection(invt, "Inventory"),
    testConnection(other, "Other"),
    testConnection(tally, "Tally"),
    testConnection(invtOakter, "Inventory (Oakter)"),
    testConnection(otherOakter, "Other (Oakter)"),
    testConnection(tallyOakter, "Tally (Oakter)"),
    testConnection(invtC25, "Inventory (C25)"),
    testConnection(otherC25, "Other (C25)"),
    testConnection(tallyC25, "Tally (C25)"),
  ]);
  console.warn("=====CONNECTION CHECK COMPLETED======");
})();
 
module.exports = { tallyDB: tally, otherDB: other, invtDB: invt, invtOakterDB: invtOakter, otherOakterDB: otherOakter, tallyOakterDB: tallyOakter,   invtC25DB: invtC25, otherC25DB: otherC25, tallyC25DB: tallyC25, };