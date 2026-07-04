const { invtDB } = require("../../config/db/connection");

const getAllotedlocation = async function (alloted_key) {
  try {
    const result = await invtDB.query(`SELECT locations FROM location_allotted WHERE loc_all_key IN (:alloted_key)`, {
      replacements: { alloted_key: alloted_key },
      type: invtDB.QueryTypes.SELECT,
    });
    return result[0];
  } catch (err) {
    throw err;
  }
};

// getAllotedlocation(202391291831908).then((result) => {
//   console.log(result);
// });

module.exports = {
  getAllotedlocation,
};
