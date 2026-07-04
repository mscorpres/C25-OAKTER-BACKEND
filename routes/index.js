var express = require("express");
var router = express.Router();

const { testDB, tallyDB, postgreDB } = require("../config/db/connection");

/* GET home page. */
router.get("/", function (req, res, next) {
	res.render("index", { title: "IMS" });
});

router.get("/checkpg11", async (req, res) => {
	try {
		let result = await postgreDB.query("SELECT * FROM people", {
			type: postgreDB.QueryTypes.SELECT,
		});
		return res.json({ result });
	} catch (err) {
		return res.json({ err: err.stack });
	}
});

router.get("/test", async (req, res) => {
	try {
		let result = await testDB.query("SELECT * FROM `admin_login`", {
			type: testDB.QueryTypes.SELECT,
		});
		return res.json({ result });
	} catch (err) {
		return res.json({ err: err.stack });
	}
});

module.exports = router;
