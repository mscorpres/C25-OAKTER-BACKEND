const express = require("express");
const router = express.Router();

const auth = require("../../middleware/auth");
let { otherDB } = require("../../config/db/connection");
const helper = require("../../helper/helper");

const Validator = require("validatorjs");

// CREATE TEAM AND ADD MEMEBER
// router.post("/add_team_in_po", [auth.isAuthorized], async (req, res) => {
//   try {
//     let validation = new Validator(req.body, {
//       team_leader: "required",
//       team_member: "required",
//       cost_center: "required",
//     });

//     if (validation.fails()) {
//       return res.json({ success: false, message: validation.errors.all(), status: "error" });
//     }

//     let stmt = await otherDB.query("SELECT * FROM ims_po_team WHERE ims_po_team_leader = :team_leader AND ims_po_team_member = :team_member AND po_cost_center = :costCenter ", {
//       replacements: { 
//         team_leader: req.body.team_leader,
//         team_member: req.body.team_member,
//         costCenter: req.body.cost_center,
//        },
//       type: otherDB.QueryTypes.SELECT,
//     });

//     if (stmt.length > 0) {
//       return res.json({ success: false, status: "error", message:"Team member already exists" });
//     } else {
//       let stmt_add = await otherDB.query("INSERT INTO ims_po_team (ims_po_team_leader,ims_po_team_member , po_cost_center) VALUES (:team_leader,:team_member , :costCenter )", {
//         replacements: { 
//           team_leader: req.body.team_leader,
//           team_member: req.body.team_member,
//           costCenter: req.body.cost_center,
//          },
//         type: otherDB.QueryTypes.INSERT,
//       });

//       return res.json({ success: true, status: "success", message: "Team member added" });
//     }
//   } catch (err) {
//     return helper.errorResponse(res, err);
//   }
// });

router.post("/add_team_in_po",  async (req, res) => {
  try {
    let validation = new Validator(req.body, {
      team_leader: "required",
      team_member: "required",
      cost_center: "required",
    });

    if (validation.fails()) {
      return res.json({ code: 500,success: false, message: validation.errors.all(), status: "error" });
    }

    const inserted = [];
    const skipped = [];
    const {team_leader,team_member,cost_center} = req.body
    for (let cc of cost_center) {
      let stmt = await otherDB.query("SELECT * FROM ims_po_team WHERE ims_po_team_leader = :team_leader AND ims_po_team_member = :team_member AND po_cost_center = :costCenter ", {
        replacements: {
          team_leader: team_leader,
          team_member: team_member,
          costCenter: cc,
        },
        type: otherDB.QueryTypes.SELECT,
      });

      if (stmt.length > 0) {
        skipped.push(cc);
      } else {
        inserted.push(cc);
      }
    }

    for (let cc of inserted) {
     let stmt_add = await otherDB.query("INSERT INTO ims_po_team (ims_po_team_leader,ims_po_team_member , po_cost_center) VALUES (:team_leader,:team_member , :costCenter )", {
          replacements: {
            team_leader: team_leader,
            team_member: team_member,
            costCenter: cc,
          },
          type: otherDB.QueryTypes.INSERT,
        });
    }
    return res.json({ code: 200, success: true, status: "success", message: inserted.length > 0 ? "Team members added" : "Team members already exists", });

  } catch (err) {
    console.log(err);
    // helper.errorMAil(err);
    return res.json({ code: 500, success: false, status: "error", message:"Internal Error!!", err: err.stack });
  }
});


// FETCH PO TEAM LEADERS
router.get("/fetch_po_team_leader", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt = await otherDB.query(`SELECT leader.user_name AS leader_name , ims_po_team_leader AS leader_id  FROM ims_po_team LEFT JOIN ${global.ims_db_name}.admin_login leader ON leader.CustID = ims_po_team.ims_po_team_leader GROUP BY ims_po_team_leader`, {
      type: otherDB.QueryTypes.SELECT,
    });

    if (stmt.length > 0) {
      let data = [];

      for (let i = 0; i < stmt.length; i++) {
        data.push({
          id: stmt[i].leader_id,
          text: stmt[i].leader_name,
        });
      }
      return res.json({ success: true, status: "success", data: data });
    } else {
      return res.json({ success: false, status: "error", message: "No Team found!!!" });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// FETCH MEMEBER LIST
router.post("/fetch_po_team_member", [auth.isAuthorized], async (req, res) => {
  try {
    const valid = new Validator(req.body, {
      search: "required",
    });

    let stmt;
    if (valid.passes()) {
      stmt = await otherDB.query(`SELECT member.user_name AS member_name , ims_po_team_member AS member_id FROM ims_po_team LEFT JOIN ${global.ims_db_name}.admin_login member ON member.CustID = ims_po_team.ims_po_team_member WHERE ims_po_team_member LIKE :search LIMIT 40`, {
        replacements: {
          search: `%${req.body.search}%`,
        },
        type: otherDB.QueryTypes.SELECT,
      });
    } else {
      stmt = await otherDB.query(`SELECT member.user_name AS member_name , ims_po_team_member AS member_id FROM ims_po_team LEFT JOIN ${global.ims_db_name}.admin_login member ON member.CustID = ims_po_team.ims_po_team_member LIMIT 40`, {
        type: otherDB.QueryTypes.SELECT,
      });
    }

    if (stmt.length > 0) {
      let data = [];

      for (let i = 0; i < stmt.length; i++) {
        data.push({
          id: stmt[i].member_id,
          text: stmt[i].member_name,
        });
      }

      return res.json({ success: true, status: "success", data: data });
    } else {
      return res.json({ success: false, status: "error", message:"No Team found!!!" });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// FETCH MEMEBER LIST
router.get("/fetch_po_team_memeber", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt = await otherDB.query(`SELECT leader.user_name AS leader_name , member.user_name AS member_name, leader.CustID AS leader_id, member.CustID AS member_id , cost.cost_center_key AS cost_center , cost.cost_center_name , cost.cost_center_short_name FROM ims_po_team LEFT JOIN ${global.ims_db_name}.admin_login leader ON leader.CustID = ims_po_team.ims_po_team_leader LEFT JOIN ${global.ims_db_name}.admin_login member ON member.CustID = ims_po_team.ims_po_team_member LEFT JOIN ${global.ims_db_name}.cost_center cost ON cost.cost_center_key = ims_po_team.po_cost_center `, {
      type: otherDB.QueryTypes.SELECT,
    });

    if (stmt.length > 0) {
      return res.json({ success: true, status: "success", data: stmt });
    } else {
      return res.json({ success: false, status: "error", message: "No Team found!!!" });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

//Delete Member
router.post("/delete_Member", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    team_leader: "required",
    team_member: "required",
    cost_center: "required",
  });

  if (validation.fails()) {
    return res.json({ success: false, message: "something you missing" , data: validation.errors.all(), status: "error" });
  }

  const transactionOt = await otherDB.transaction();

  try {

    const { team_leader, team_member, cost_center } = req.body;

    let pagestsmt = await otherDB.query("SELECT ims_po_team_leader, ims_po_team_member FROM `ims_po_team` WHERE `ims_po_team_leader` = :team_leader AND `ims_po_team_member` = :team_member AND `po_cost_center` = :cost_center ", {
      replacements: { team_leader, team_member, cost_center },
      type: otherDB.QueryTypes.SELECT,
    });
    if (pagestsmt.length > 0) {
      let stmt1 = await otherDB.query("DELETE FROM `ims_po_team` WHERE `ims_po_team_leader` = :team_leader AND `ims_po_team_member` = :team_member AND `po_cost_center` = :cost_center ", {
        replacements: { team_leader, team_member, cost_center },
        type: otherDB.QueryTypes.DELETE,
        transaction: transactionOt,
      });
      await transactionOt.commit();
      return res.json({ success: true, message: "Member deleted successfully", status: "success" });
    } else {
      transactionOt.rollback();
      return res.json({ success: false, message: "No Member found", status: "error" });
    }
  } catch (err) {
    transactionOt.rollback();
    return helper.errorResponse(res, err);
  }
});

module.exports = router;
