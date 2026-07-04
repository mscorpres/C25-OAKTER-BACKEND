const { invtDB } = require("../../config/db/connection");

const getCurrentInwardAtlocationQuery = `SELECT COALESCE(SUM(qty+other_qty), 0) AS Inward FROM rm_location WHERE components_id = :component AND trans_type IN ('INWARD' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER') AND loc_in IN (:location)`;

const getCurrentOutwardAtlocationQuery = `SELECT COALESCE(SUM(qty+other_qty), 0) AS Outward FROM rm_location WHERE components_id = :component AND trans_type IN ('CONSUMPTION' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER') AND loc_out IN (:location)`;

const getDateInwardQuery = `SELECT COALESCE(SUM(CASE WHEN trans_type IN ('INWARD' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER') AND loc_in IN (:location) THEN qty ELSE 0 END ), 0 ) AS Inward FROM rm_location WHERE (DATE_FORMAT(insert_date,'%Y-%m-%d') <= :report_date) AND components_id = :component`;

const getDateOutwardQuery = `SELECT COALESCE(SUM(CASE WHEN trans_type IN ('CONSUMPTION' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER') AND loc_out IN (:location) THEN qty ELSE 0 END ), 0) AS Outward FROM rm_location WHERE (DATE_FORMAT(insert_date,'%Y-%m-%d') <= :report_date) AND components_id = :component`;

const getCurrentInwardAtlocation = async function (part, location) {
  try {
    const result = await invtDB.query(getCurrentInwardAtlocationQuery, {
      replacements: {
        component: part,
        location: location,
      },
      type: invtDB.QueryTypes.SELECT,
    });

    return result[0].Inward;
  } catch (err) {
    throw err;
  }
};

const getCurrentOutwardAtlocation = async function (part, location) {
  try {
    const result = await invtDB.query(getCurrentOutwardAtlocationQuery, {
      replacements: {
        component: part,
        location: location,
      },
      type: invtDB.QueryTypes.SELECT,
    });
    return result[0].Outward;
  } catch (err) {
    throw err;
  }
};

const getCurrentClosedAtlocation = async function (part, location) {
  try {
    const result = await invtDB.query(` SELECT (${getCurrentInwardAtlocationQuery}) - (${getCurrentOutwardAtlocationQuery}) AS Closed `, {
      replacements: {
        component: part,
        location: location,
      },
      type: invtDB.QueryTypes.SELECT,
    });
    return result[0].Closed;
  } catch (err) {
    throw err;
  }
};

const getCurrentInOutClosedAtlocation = async function (part, location) {
  try {
    const result = await invtDB.query(` SELECT (${getCurrentInwardAtlocationQuery}) as Inward , (${getCurrentOutwardAtlocationQuery}) as Outward FROM DUAL `, {
      replacements: {
        component: part,
        location: location,
      },
      type: invtDB.QueryTypes.SELECT,
    });
    return {
      Inward: result[0].Inward,
      Outward: result[0].Outward,
      Closed: result[0].Inward - result[0].Outward,
    };
  } catch (err) {
    throw err;
  }
};

const getDateInwardAtlocation = async function (part, location, date) {
  try {
    const result = await invtDB.query(getDateInwardQuery, {
      replacements: {
        component: part,
        location: location,
        report_date: date,
      },
      type: invtDB.QueryTypes.SELECT,
    });
    return result[0].Inward;
  } catch (err) {
    throw err;
  }
};

const getDateOutwardAtlocation = async function (part, location, date) {
  try {
    const result = await invtDB.query(getDateOutwardQuery, {
      replacements: {
        component: part,
        location: location,
        report_date: date,
      },
      type: invtDB.QueryTypes.SELECT,
    });
    return result[0].Outward;
  } catch (err) {
    throw err;
  }
};

const getDateInOutClosedAtlocation = async function (part, location, date) {
  try {
    const result = await invtDB.query(` SELECT (${getDateInwardQuery}) as Inward , (${getDateOutwardQuery}) AS Outward FROM DUAL `, {
      replacements: {
        component: part,
        location: location,
        report_date: date,
      },
      type: invtDB.QueryTypes.SELECT,
    });
    return {
      Inward: result[0].Inward,
      Outward: result[0].Outward,
      Closed: result[0].Inward - result[0].Outward,
    };
  } catch (err) {
    throw err;
  }
};

// getDateInOutClosedAtlocation("20210830171107", "20211025151804", "2024-06-25").then((data) => {
//   console.log(data);
// });

module.exports = {
  getCurrentInwardAtlocation,
  getCurrentOutwardAtlocation,
  getCurrentClosedAtlocation,
  getCurrentInOutClosedAtlocation,
  getDateInwardAtlocation,
  getDateOutwardAtlocation,
};
