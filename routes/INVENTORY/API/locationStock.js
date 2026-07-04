const express = require("express");
const router = express.Router();
const { invtDB, otherDB } = require("../../../config/db/connection");

// Middleware to validate API token
const validateApiToken = async (req, res, next) => {
  const authHeader = req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.json({
      code: 401,
      message: "No token provided",
      status: "error",
      success: false,
    });
  }

  const token = authHeader.replace("Bearer ", "");
  try {
    const currentTime = moment.tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");
    const tokenRecord = await otherDB.query(
      `SELECT *, 
                  expires_at AS expires_at_raw 
           FROM tbl_api_tokens 
           WHERE token = :token 
             AND expires_at > :currentTime`,
      {
        replacements: { token, currentTime },
        type: otherDB.QueryTypes.SELECT,
      }
    );

    if (!tokenRecord.length) {
      return res.json({
        code: 401,
        message: "Invalid OR the token has been expired",
        status: "error",
        success: false,
      });
    }

    req.client_code = tokenRecord[0].client_code;
    next();
  } catch (error) {
    console.error("Error validating API token:", error);
    return helper.errorResponse(res, error);
  }
};

const helper = {
  number: (v) => {
    const n = Number(v);
    return Number.isNaN(n) ? 0 : n;
  },
};

// ✅ Opening balance (inward - outward before session start)
async function getOpeningBalance(componentKey, location, currentSession) {
  try {
    const sessionStartYear = parseInt(currentSession.split("-")[0], 10);
    const sessionStartDate = `20${sessionStartYear}-04-01 00:00:00`;

    const [inwardResult, outwardResult] = await Promise.all([
      invtDB.query(
        `SELECT COALESCE(SUM(qty), 0) AS total_inward
                 FROM rm_location 
                 WHERE components_id = :component 
                   AND trans_type IN ('INWARD', 'ISSUE', 'JOBWORK', 'REJECTION', 'TRANSFER') 
                   AND loc_in = :location 
                   AND DATE_FORMAT(insert_date, '%Y-%m-%d %H:%i:%s') < :sessionStartDate`,
        {
          replacements: { component: componentKey, location, sessionStartDate },
          type: invtDB.QueryTypes.SELECT,
        }
      ),
      invtDB.query(
        `SELECT COALESCE(SUM(qty), 0) AS total_outward 
                 FROM rm_location 
                 WHERE components_id = :component 
                   AND trans_type IN ('CONSUMPTION', 'ISSUE', 'JOBWORK', 'REJECTION', 'TRANSFER') 
                   AND loc_out = :location 
                   AND DATE_FORMAT(insert_date, '%Y-%m-%d %H:%i:%s') < :sessionStartDate`,
        {
          replacements: { component: componentKey, location, sessionStartDate },
          type: invtDB.QueryTypes.SELECT,
        }
      ),
    ]);

    const inward = helper.number(inwardResult[0]?.total_inward || 0);
    const outward = helper.number(outwardResult[0]?.total_outward || 0);
    return inward - outward;
  } catch (error) {
    console.error("Error calculating opening balance:", error);
    return 0;
  }
}

// ✅ Get location name
async function getLocationName(locationKey) {
  try {
    const locationResult = await invtDB.query(
      `SELECT loc_name FROM location_main WHERE location_key = :location`,
      {
        replacements: { location: locationKey },
        type: invtDB.QueryTypes.SELECT,
      }
    );
    return locationResult.length > 0 ? locationResult[0].loc_name : "--";
  } catch (error) {
    console.error("Error fetching location name:", error);
    return "--";
  }
}

// ✅ Session-wise inward/outward
async function getSessionWiseQuantities(componentKey, location, session) {
  const [inwardResult, outwardResult] = await Promise.all([
    invtDB.query(
      `SELECT COALESCE(SUM(qty), 0) AS Inward 
             FROM rm_location 
             WHERE components_id = :component 
               AND trans_type IN ('INWARD', 'ISSUE', 'JOBWORK', 'REJECTION', 'TRANSFER') 
               AND loc_in = :location 
               AND txn_session = :session`,
      {
        replacements: { component: componentKey, location, session },
        type: invtDB.QueryTypes.SELECT,
      }
    ),
    invtDB.query(
      `SELECT COALESCE(SUM(qty), 0) AS Outward 
             FROM rm_location 
             WHERE components_id = :component 
               AND trans_type IN ('CONSUMPTION', 'ISSUE', 'JOBWORK', 'REJECTION', 'TRANSFER') 
               AND loc_out = :location 
               AND txn_session = :session`,
      {
        replacements: { component: componentKey, location, session },
        type: invtDB.QueryTypes.SELECT,
      }
    ),
  ]);

  return {
    inward: helper.number(inwardResult[0]?.Inward || 0),
    outward: helper.number(outwardResult[0]?.Outward || 0),
  };
}

// ✅ Main API — supports multiple locations
router.post("/location/stock", [validateApiToken], async (req, res) => {
  try {
    let { location, part } = req.body;

    // this session code will retun auto session year like 25-26, 26-27, 27-28, etc.
    const session = `${
      moment().month() >= 3
        ? moment().format("YY")
        : moment().subtract(1, "year").format("YY")
    }-${
      moment().month() >= 3
        ? moment().add(1, "year").format("YY")
        : moment().format("YY")
    }`;

    // Convert to array if single string
    const locations = Array.isArray(location) ? location : [location];

    if (!locations.length || !part) {
      return res.json({
        success: false,
        message: "Location(s) and Part are required",
      });
    }

    // max 30 locations
    if (locations.length > 30) {
      return res.json({
        success: false,
        message: "Maximum 30 locations allowed",
      });
    }

    // Component info
    const componentResult = await invtDB.query(
      `SELECT components.*, units.units_name, components.c_new_part_no, 
                    components.c_name, components.c_part_no, components.attribute_code, components.manufacturing_code
             FROM components 
             LEFT JOIN units ON units.units_id = components.c_uom 
             WHERE (components.c_part_no = :partcode OR components.component_key = :partcode)`,
      {
        replacements: { partcode: part },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (componentResult.length === 0) {
      return res.json({ success: false, message: "No component found" });
    }

    const component = componentResult[0];
    const componentKey = component.component_key;

    // 🔁 For each location
    const locationReports = [];

    for (const loc of locations) {
      const locationName = await getLocationName(loc);

      const [sessionQuantities, openingBalance] = await Promise.all([
        getSessionWiseQuantities(componentKey, loc, session),
        getOpeningBalance(componentKey, loc, session),
      ]);

      const closingQuantity =
        openingBalance + sessionQuantities.inward - sessionQuantities.outward;

      locationReports.push({
        location: locationName,
        // stock: {
        // opening: helper.number(openingBalance),
        // inward: helper.number(sessionQuantities.inward),
        // outward: helper.number(sessionQuantities.outward),
        closing: helper.number(closingQuantity),
        // }
      });
    }

    // ✅ Final response
    return res.json({
      status: "success",
      success: true,

      data: {
        partNo: `${component.c_new_part_no || ""}`,
        partName: component.c_name || "",
        partStatus: component.c_is_enabled == "Y" ? "Active" : "Inactive",
        uom: component.units_name || "",
        unique_id: component.attribute_code || "--",
        mfgCode: component.manufacturing_code || "--",
        locations: locationReports,
      },
    });
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

// List of locations
router.get("/location/all", [validateApiToken], async (req, res) => {
  try {
    const locations = await invtDB.query(
      "SELECT location_key , loc_name FROM location_main WHERE loc_type = '1' AND loc_status = 'ACTIVE' ORDER BY loc_name ASC",
      {
        type: invtDB.QueryTypes.SELECT,
      }
    );
    if (locations.length === 0) {
      return res.json({ success: false, message: "No locations found" });
    }
    return res.json({
      status: "success",
      success: true,

      data: locations.map((location) => ({
        key: location.location_key,
        name: location.loc_name,
      })),
    });
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

module.exports = router;
