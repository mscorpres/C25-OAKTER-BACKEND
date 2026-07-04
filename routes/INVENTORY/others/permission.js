const express = require("express");
const router = express.Router();

let { invtDB, otherDB } = require("../../../config/db/connection");


const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");

const archiver = require("archiver");
const path = require("path");
const fs = require("fs");

const Validator = require("validatorjs");

const { google } = require("googleapis");

destination_directory = path.join(__dirname + "./../../../backups/");

// Fetch all permissions y USER_ID
router.post("/viewPermission", [auth.isAuthorized], async (req, res) => {
	try {
		const stmt = await otherDB.query("SELECT * FROM `ims_permission` WHERE `username` = :user_id", {
			replacements: { user_id: req.body.USER_ID },
			type: otherDB.QueryTypes.SELECT,
		});
		const stmt2 = await invtDB.query("SELECT user_name,CustID,Email_ID,type FROM `admin_login` WHERE `CustID` = :user_id ", {
			replacements: { user_id: req.body.USER_ID },
			type: invtDB.QueryTypes.SELECT,
		});

		if (stmt.length > 0) {
			return res.json({ status: "success", success: true, message: "", data: stmt, user_data: stmt2[0] });
		} else {
			return res.json({ status: "error", success: false, message: "No data found" });
		}
	} catch (error) {
	    return helper.errorResponse(res, error);
	}
});

// ADD NEW PAGE
router.post("/addPage", [auth.isAuthorized], async (req, res) => {
	let validation = new Validator(req.body, {
		page_name: "required",
		parent: "required",
		asktopermission: "required|in:Y,N",
	});

	if (validation.fails()) {
		return res.json({ status: "error", success: false, message: "something you missing in form field to supply" });
	}

	const transactionOt = await otherDB.transaction();
	try {
		let unique_page_id = Math.floor(Math.random() * 99999999 + 10000000);
		let pagestsmt = await otherDB.query("SELECT `page_id` FROM `page_list` WHERE `page_id` = :page_id", {
			replacements: { page_id: unique_page_id },
			type: otherDB.QueryTypes.SELECT,
		});
		if (pagestsmt.length > 0) {
			transactionotherDB.rollback();
			return res.json({ status: "error", success: false, message: "Page already exist" });
		} else {
			const userstsmt = await invtDB.query("SELECT `CustID` FROM `admin_login`", {
				replacements: { user_id: req.body.USER_ID },
				type: invtDB.QueryTypes.SELECT,
			});
			let stmt;

			if (userstsmt.length > 0) {
				let count = 0;
				if (req.body.asktopermission == "Y") {
					userstsmt.map(async (users) => {
						count++;

						let permstmt = await otherDB.query("INSERT INTO `ims_permission` (`username`, `page_id`, `page_name`, `permission`) VALUES (:username, :page_id, :page_name ,:permission)", {
							replacements: {
								username: users.CustID,
								page_id: unique_page_id,
								page_name: req.body.page_name,
								permission: JSON.stringify({ create: "false", edit: "false", delete: "false", upload: "false", view: "false" }),
							},
							type: otherDB.QueryTypes.INSERT,
							transaction: transactionOt,
						});
					});
					stmt = await otherDB.query("INSERT INTO `page_list` (`page_name`,`page_id`,`parent_page`,`need_permission`,`added_date`) VALUES (:page_name,:page_id,:parent,:permission,:added_date)", {
						replacements: { page_name: req.body.page_name, page_id: unique_page_id, parent: req.body.parent, permission: req.body.asktopermission, added_date: moment().format("YYYY-MM-DD HH:mm:ss") },
						type: otherDB.QueryTypes.INSERT,
						transaction: transactionOt,
					});
				} else {
					stmt = await otherDB.query("INSERT INTO `page_list` (`page_name`,`page_id`,`parent_page`,`need_permission`,`added_date`) VALUES (:page_name,:page_id,:parent,:permission,:added_date)", {
						replacements: { page_name: req.body.page_name, page_id: unique_page_id, parent: req.body.parent, permission: req.body.asktopermission, added_date: moment().format("YYYY-MM-DD HH:mm:ss") },
						type: otherDB.QueryTypes.INSERT,
						transaction: transactionOt,
					});
				}
			}

			if (stmt.length > 0) {
				await transactionOt.commit();
				return res.json({ status: "success", success: true, message: "Page added successfully", data: {} });
			} else {
				transactionOt.rollback();
				return res.json({ status: "error", success: false, message: "an error occured while adding page" });
			}
		}
	} catch (error) {
	    return helper.errorResponse(res, error);
	}
});

// SEND REQUEST FOR PERMISSION
router.post("/request", [auth.isAuthorized], async (req, res) => {
	let validation = new Validator(req.body, {
		page_url: "required",
		user_msg: "required",
	});

	if (validation.fails()) {
		return res.json({ status: "error", success: false, message: "something you missing in form field to supply" });
	}

	const transactionOt = await otherDB.transaction();

	try {
		let stmt = await otherDB.query("INSERT INTO `ims_permission_req` (`data_logs`, `req_by`, `req_dt`) VALUES(:data, :insert_by, :insert_date)", {
			replacements: {
				data: JSON.stringify({
					user_message: req.body.user_msg,
					page_url: req.body.page_url,
				}),
				insert_by: req.logedINUser,
				insert_date: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
			},
			type: otherDB.QueryTypes.INSERT,
			transaction: transactionOt,
		});
		if (stmt.length > 0) {
			await transactionOt.commit();
			return res.json({ status: "success", success: true, message: "request successfully sent to administrator", data: {} });
		} else {
			transactionOt.rollback();
			return res.json({ status: "error", success: false, message: "an error occured while receiving your request" });
		}
	} catch (error) {
	    return helper.errorResponse(res, error);
	}
});

// DELETE PAGE
router.post("/deletePage", [auth.isAuthorized], async (req, res) => {
	let validation = new Validator(req.body, {
		page_id: "required",
	});

	if (validation.fails()) {
		return res.json({ status: "error", success: false, message: "something you missing in form field to supply" });
	}

	const transactionOt = await otherDB.transaction();

	try {
		let pagestsmt = await otherDB.query("SELECT page_id FROM `page_list` WHERE `page_id` = :page_id", {
			replacements: { page_id: req.body.page_id },
			type: otherDB.QueryTypes.SELECT,
		});
		if (pagestsmt.length > 0) {
			let stmt = await otherDB.query("DELETE FROM `page_list` WHERE `page_id` = :page_id", {
				replacements: { page_id: req.body.page_id },
				type: otherDB.QueryTypes.DELETE,
				transaction: transactionOt,
			});
			let stmt2 = await otherDB.query("DELETE FROM `ims_permission` WHERE `page_id` = :page_id", {
				replacements: { page_id: req.body.page_id },
				type: otherDB.QueryTypes.DELETE,
				transaction: transactionOt,
			});
			await transactionOt.commit();
			return res.json({ status: "success", success: true, message: "Page deleted successfully", data: {} });
		} else {
			transactionOt.rollback();
			return res.json({ status: "error", success: false, message: "No user found" });
		}
	} catch (error) {
	    return helper.errorResponse(res, error);
	}
});

// INITIATE BACKUP
router.post("/initiateBackup", [auth.isAuthorized], async (req, res) => {
	let validation = new Validator(req.body, {
		backup_type: "required",
	});

	if (validation.fails()) {
		return res.json({ status: "error", success: false, message: "something you missing in form field to supply" });
	}
	
	if(req.body.backup_type == "F"){
		return res.json({ status: "error", success: false, message: "frontend backup not allowed on this api" });
	}

	const transactionOt = await otherDB.transaction();

	let backuptype, backup_directory, type;

	if (req.body.backup_type == "F") {
		backuptype = "FrontEnd (UI)";
		backup_directory = path.join(__dirname + "./../../../../ims.mscorpres.net/");
		type = "HTML";
	} else if (req.body.backup_type == "B") {
		backuptype = "Backend API(s)";
		backup_directory = path.join(__dirname + "./../../../");
		type = "API";
	} else {
		transactionOt.rollback();
		return res.json({ status: "error", success: false, message: "backup type not allowed to initiate action" });
	}

	filename = backuptype + " " + moment(new Date()).tz("Asia/Kolkata").format("DD-MM-YYYY hh-mm-ss A") + ".zip";

	if (req.body.backup_type == "F" || req.body.backup_type == "B") {
		try {
			const output = fs.createWriteStream(destination_directory + filename);
			const archive = archiver("zip", {
				zlib: { level: 9 },
			});

			output.on("close", async function () {
				console.warn("destination of backup" + destination_directory);
				console.warn("backup directory " + backup_directory);
				console.warn(archive.pointer() + " total bytes");

				let stmt1 = await otherDB.query("INSERT INTO `project_backup` (`backup_type`,`backup_data`, `backup_logs`) VALUES(:type, :data, :logs)", {
					replacements: {
						type: type,
						data: JSON.stringify({
							file_name: filename,
							file_url: "/backups/" + filename,
							file_size: archive.pointer(),
						}),
						logs: JSON.stringify({
							insert_date: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
							insert_by: req.logedINUser,
							delete_date: moment(new Date()).add(7, "days").tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
						}),
					},
					type: otherDB.QueryTypes.INSERT,
					transaction: transactionOt,
				});

				if (stmt1.length > 0) {
					await transactionOt.commit();
					return res.json({ status: "success", success: true, message: backuptype + " backup has been finalized, file(s) & data log will reflect after few moments later", data: {} });
				} else {
					fs.unlinkSync(destination_directory + filename);
					transactionOt.rollback();
					return res.json({ status: "error", success: false, message: "an error while initiated the backup, contact to developer" });
				}
			});

			output.on("end", function () {
				fs.unlinkSync(destination_directory + filename);
				transactionOt.rollback();
				console.warn("request has been drained while backup project");
			});

			archive.on("warning", function (err) {
				if (err.code === "ENOENT") {
					fs.unlinkSync(destination_directory + filename);
					transactionOt.rollback();
					return res.json({ status: "error", success: false, message: "Warning : " + err });
				} else {
					fs.unlinkSync(destination_directory + filename);
					transactionOt.rollback();
					throw err;
				}
			});

			archive.on("error", function (err) {
				fs.unlinkSync(destination_directory + filename);
				transactionOt.rollback();
				throw err;
			});

			archive.pipe(output);
			archive.glob("**", { cwd: backup_directory, ignore: [".well-known/**", "App_Data/**", "node_modules/**", "iisnode/**", "*.log", "*.zip", "*.gitignore", "*.vscode/**", "backups/**"] }, {});
			archive.finalize();
		} catch (error) {
		    return helper.errorResponse(res, error);
		}
	} else {
		console.log("ERROR");
	}
});

// GET ALL BACKUPS FOR LISTING
router.post("/getbackuplist", [auth.isAuthorized], async (req, res) => {
	try {
		let data = [];
		stmt = await otherDB.query("SELECT * FROM `project_backup` WHERE `backup_cloud_status` != 'DELETE' ORDER BY `ID` DESC", {
			type: otherDB.QueryTypes.SELECT,
		});
		if (stmt.length > 0) {
			stmt.forEach((element) => {
				let jsonData_data = JSON.parse(element.backup_data);
				let jsonData_log = JSON.parse(element.backup_logs);
				data.push({
					file_name: jsonData_data.file_name.replace(".zip", ""),
					file_size: helper.fileSize(jsonData_data.file_size),
					file_url: element.backup_type == "HTML" ? "https://mscorpres.co.in/Backups/" + jsonData_data.file_name : element.backup_type == "API" ? "http://ims.mscapi.live/backups/" + jsonData_data.file_name : "NA"  ,
					created_by: "--",
					created_date: moment(jsonData_log.insert_date).tz("Asia/Kolkata").format("DD-MM-YYYY hh:mm:ss A"),
					backup: element.backup_cloud_status,
				});
			});

			if (stmt.length == data.length) {
				return res.json({ status: "success", success: true, message: "", data: data });
			}
		} else {
			return res.json({ status: "error", success: false, message: "no any backup found" });
		}
	} catch (error) {
	    return helper.errorResponse(res, error);
	}
});

// GET ALL BACKUPS FOR UPLOAD AND IN SELECTBOX
router.post("/selectBackup", [auth.isAuthorized], async (req, res) => {
	const validation = new Validator(req.body, {
		type: "required",
	});

	if (validation.fails()) {
		return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(validation) });
	}

	try {
		const limit = 1;
		let stmt;
		if (req.body.search) {
			stmt = await otherDB.query(
				"SELECT * FROM `project_backup` WHERE LOWER(json_unquote(json_extract(`backup_data`,'$[0].file_name'))) LIKE LOWER(:name) AND `backup_cloud_status` != 'DELETE' AND `backup_type` = :type ORDER BY `ID` DESC LIMIT :limit",
				{
					replacements: { name: `%${req.body.search}%`, type: req.body.type },
					type: otherDB.QueryTypes.SELECT,
				}
			);
		} else {
			stmt = await otherDB.query("SELECT * FROM `project_backup` WHERE `backup_cloud_status` != 'DELETE' AND `backup_type` = :type ORDER BY `ID` DESC LIMIT :limit", {
				replacements: { type: req.body.type, limit: limit },
				type: otherDB.QueryTypes.SELECT,
			});
		}

		let final = [];

		stmt.map((item) => {
			let jsonData_data = JSON.parse(item.backup_data);
			final.push({ id: jsonData_data.file_name, text: jsonData_data.file_name.replace(".zip", "") });
			if (stmt.length == final.length) {
				res.json(final);
				return;
			} else {
				console.log("OPS");
			}
		});
	} catch (error) {
	    return helper.errorResponse(res, error);
	}
});

// DELETE THE BACKUP
router.post("/deleteBackup", [auth.isAuthorized], async (req, res) => {
	const validation = new Validator(req.body, {
		filename: "required",
	});

	if (validation.fails()) {
		return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(validation) });
	}

	const transactionOt = await otherDB.transaction();
	try {
		let stmt1 = await otherDB.query("SELECT * FROM `project_backup` WHERE json_unquote(json_extract(`backup_data`,'$[0].file_name')) = :filename ", {
			replacements: { filename: req.body.filename },
			type: otherDB.QueryTypes.SELECT,
			transaction: transactionOt,
		});

		if (stmt1.length > 0) {
			let stmt2 = await otherDB.query("UPDATE `project_backup` SET `backup_cloud_status` = :status WHERE json_unquote(json_extract(`backup_data`,'$[0].file_name')) = :filename ", {
				replacements: { filename: req.body.filename, status: "DELETE" },
				type: otherDB.QueryTypes.DELETE,
				transaction: transactionOt,
			});

			if (stmt1.length > 0) {
				if (stmt1[0].backup_cloud_status == "PENDING") {
					fs.unlinkSync(destination_directory + req.body.filename);
				}
				transactionOt.commit();
				return res.json({ status: "success", success: true, message: "backup deleted successfully..", data: {} });
			} else {
				transactionOt.rollback();
				return res.json({ status: "error", success: false, message: "an error while deleting backup" });
			}
		} else {
			transactionOt.rollback();
			return res.json({ status: "error", success: false, message: "no file found to delete or selected file are invalid" });
		}
	} catch (error) {
	    return helper.errorResponse(res, error);
	}
});

//UPLOAD IN GOOGLE DRIVE
router.post("/uploadDrive", [auth.isAuthorized], async (req, res) => {
	const validation = new Validator(req.body, {
		filename: "required",
		filetype: "required",
	});

	if (validation.fails()) {
		return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(validation) });
	}

	function delete_folder() {
		fs.unlink(destination_directory + req.body.filename, (err) => {
			if (err) console.log(err);
			else {
				console.log("\nDeleted file: " + req.body.filename);
			}
		});
	}

	const transactionOt = await otherDB.transaction();

	try {
		let stmt1 = await otherDB.query("SELECT * FROM `project_backup` WHERE json_unquote(json_extract(`backup_data`,'$[0].file_name')) = :filename AND `backup_type` = :filetype ", {
			replacements: { filename: req.body.filename, filetype: req.body.filetype },
			type: otherDB.QueryTypes.SELECT,
		});

		if (stmt1.length > 0) {
			let perm_obj = JSON.parse(stmt1[0].backup_data);

			if (stmt1[0].backup_cloud_status == "DONE") {
				transactionOt.rollback();
				return res.json({ status: "error", success: false, message: "you have already upload this on cloud" });
			} else {
				let GOOGLE_API_FOLDER_ID;
				if (req.body.filetype == "HTML") {
					GOOGLE_API_FOLDER_ID = "1ouwhQy7wnuOfY8PVOCvWNNybGprjOxGw";
				} else if (req.body.filetype == "API") {
					GOOGLE_API_FOLDER_ID = "1Fjemn_SD1iHZRkp-9elc6upI3fzTc6B2";
				} else {
					return res.json({ status: "error", success: false, message: "select the valid project type to upload it on cloud" });
				}

				async function uploadFile() {
					try {
						const auth = new google.auth.GoogleAuth({
							keyFile: "./helper/backupDrive.json",
							scopes: ["https://www.googleapis.com/auth/drive"],
						});

						const driveService = google.drive({
							version: "v3",
							auth,
						});

						const fileMetaData = {
							name: req.body.filename.replace(".zip", ""),
							parents: [GOOGLE_API_FOLDER_ID],
						};

						const media = {
							mimeType: "application/zip",
							body: fs.createReadStream(destination_directory + req.body.filename),
						};

						const response = await driveService.files.create({
							resource: fileMetaData,
							media: media,
							field: "id",
						});
						return response.data.id;
					} catch (err) {
					    return helper.errorResponse(res, err);
					}
				}

				uploadFile().then(async (data) => {
					perm_obj["file_url"] = "https://drive.google.com/file/u/0/d/" + data;
					let stmt2 = await otherDB.query(
						"UPDATE `project_backup` SET `backup_data` = :data, `backup_cloud_status` = :status, `cloud_file_id` = :fileid WHERE json_unquote(json_extract(`backup_data`,'$[0].file_name')) = :filename AND `backup_type` = :filetype ",
						{
							replacements: { data: JSON.stringify(perm_obj), filename: req.body.filename, filetype: req.body.filetype, status: "DONE", fileid: data },
							type: otherDB.QueryTypes.UPDATE,
							transaction: transactionOt,
						}
					);
					if (stmt2.length > 0) {
						fs.unlinkSync(destination_directory + filename);
						transactionOt.commit();
						return res.json({ status: "success", success: true, message: "File uploaded on cloud succeessfully...", data: {} });
					} else {
						transactionOt.rollback();
						return res.json({ status: "error", success: false, message: "an error while updating the file status on server" });
					}
				});
			}
		} else {
			transactionOt.rollback();
			return res.json({ status: "error", success: false, message: "no file found to upload it on server OR invalid" });
		}
	} catch (error) {
	    return helper.errorResponse(res, error);
	}
});

//DELETE FROM CLOUD STORAGE AUTOMATICALY
router.post("/deleteCloudBackup", async (req, res) => {
	const transactionOt = await otherDB.transaction();
	try {
		let stmt1 = await otherDB.query("SELECT * FROM `project_backup` WHERE `cloud_file_id` != '--'", {
			type: otherDB.QueryTypes.SELECT,
		});

		if (stmt1.length > 0) {
			stmt1.forEach(async (element) => {
				let jsonData = JSON.parse(element.backup_logs);

				if (moment(jsonData.delete_date, "YYYY-MM-DD HH:mm:ss").diff(moment(new Date(), "YYYY-MM-DD HH:mm:ss"), "seconds") <= 0) {
					async function deleteFile() {
						try {
							const auth = new google.auth.GoogleAuth({
								keyFile: "./helper/backupDrive.json",
								scopes: ["https://www.googleapis.com/auth/drive"],
							});

							const driveService = google.drive({
								version: "v3",
								auth,
							});

							const response = await driveService.files.delete({
								fileId: element.cloud_file_id,
							});
							return response;
						} catch (err) {
							console.log("an error occured while deleting file from server ", err);
						}
					}
					deleteFile();
					let stmt2 = await otherDB.query("DELETE FROM `project_backup` WHERE `cloud_file_id` = :fileid", {
						replacements: { fileid: element.cloud_file_id },
						type: otherDB.QueryTypes.DELETE,
						transaction: transactionOt,
					});
					transactionOt.commit();
				}
			});
		} else {
			transactionOt.rollback();
			return res.json({ status: "error", success: false, message: "no file found to delete" });
		}
	} catch (error) {
	    return helper.errorResponse(res, error);
	}
});

// VIEW PAGE PERMISION
router.post("/viewPagePermission", [auth.isAuthorized], async (req, res) => {
	try {
		stmt = await otherDB.query("SELECT `page_list`.`page_name`,`page_list`.`page_id`,`page_list`.`parent_page`,`page_list`.`need_permission`,`page_list`.`page_url` FROM `page_list` ORDER BY `page_list`.`ID` ASC", {
			replacements: { user_id: req.body.USER_ID },
			type: otherDB.QueryTypes.SELECT,
		});

		let final = [];
		if (stmt.length > 0) {
			stmt.map(async (item) => {
				let stmt2 = await otherDB.query("SELECT * FROM `ims_permission2` WHERE `ims_permission2`.`user_id` = :user_id AND page_id = :page_id ", {
					replacements: { user_id: req.body.USER_ID, page_id: item.page_id },
					type: otherDB.QueryTypes.SELECT,
				});

				let isPermission = false;

				if (stmt2.length > 0) {
					isPermission = true;
				}

				final.push({ page_id: item.page_id, page_name: item.page_name, parent_page: item.parent_page, need_permission: item.need_permission, page_url: item.page_url, isPermission: isPermission });

				if (stmt.length == final.length) {
					tree = (function (data, root) {
						var t = {};
						data.forEach(({ page_id, page_name, parent_page, need_permission, page_url, isPermission }) => {
							Object.assign((t[page_id] = t[page_id] || {}), { key: page_id, title: page_name, folder: need_permission == "N" ? true : false, purl: page_url, checkbox: need_permission == "N" ? false : true, selected: isPermission });
							t[parent_page] = t[parent_page] || {};
							t[parent_page].children = t[parent_page].children || [];
							t[parent_page].children.push(t[page_id]);
						});
						return t[root].children;
					})(final, "--");

					return res.json({ status: "success", success: true, message: "", data: tree });
				}
			});
		} else {
			return res.json({ status: "error", success: false, message: "No Data Found" });
		}
	} catch (error) {
	    return helper.errorResponse(res, error);
	}
});

// UPDATE PAGE PERMISION
router.post("/updatePermission", [auth.isAuthorized], async (req, res) => {
	try {
		let validation = new Validator(req.body, {
			user_id: "required",
			page_id: "required",
		});

		if (validation.fails()) {
			return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(validation) });
		}

		let stmt = await otherDB.query("SELECT * FROM `ims_permission2` WHERE `ims_permission2`.`user_id` = :user_id AND page_id = :page_id ", {
			replacements: { user_id: req.body.user_id, page_id: req.body.page_id },
			type: otherDB.QueryTypes.SELECT,
		});

		if (stmt.length > 0) {
			let stmt2 = await otherDB.query("DELETE FROM `ims_permission2` WHERE `ims_permission2`.`user_id` = :user_id AND page_id = :page_id ", {
				replacements: { user_id: req.body.user_id, page_id: req.body.page_id },
				type: otherDB.QueryTypes.DELETE,
			});

			return res.json({ status: "success", success: true, message: "Permission Removed", data: {} });
		} else {
			let stmt2 = await otherDB.query("INSERT INTO `ims_permission2` (`user_id`, `page_id`,`insert_by`) VALUES (:user_id, :page_id, :insert_by)", {
				replacements: { user_id: req.body.user_id, page_id: req.body.page_id, insert_by: req.logedINUser },
				type: otherDB.QueryTypes.INSERT,
			});

			if (stmt2.length > 0) {
				return res.json({ status: "success", success: true, message: "Permission Added", data: {} });
			}
		}
	} catch (error) {
	    return helper.errorResponse(res, error);
	}
});

module.exports = router;
