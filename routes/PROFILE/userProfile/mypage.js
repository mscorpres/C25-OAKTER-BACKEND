const express = require("express");
const router = express.Router();
var bcrypt = require("bcryptjs");


const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");
let { invtDB, otherDB } = require("../../../config/db/connection");
const sms = require("../../../helper/smsGateway");

const Validator = require("validatorjs");

function makeReferenceID(length) {
	var result = "";
	var characters = "MSCORPRES2017";
	var charactersLength = characters.length;
	for (var i = 0; i < length; i++) {
		result += characters.charAt(Math.floor(Math.random() * charactersLength));
	}
	return result;
}
function makeOTP(length) {
	var result = "";
	var characters = "0123456789";
	var charactersLength = characters.length;
	for (var i = 0; i < length; i++) {
		result += characters.charAt(Math.floor(Math.random() * charactersLength));
	}
	return result;
}

//FETCH USER DETAILS
router.get("/userDetails", [auth.isAuthorized], async (req, res) => {
	try {
		let stmt = await invtDB.query(
			"SELECT * FROM `admin_login` WHERE `CustID` = :userid",
			{
				replacements: { userid: req.logedINUser },
				type: invtDB.QueryTypes.SELECT,
			}
		);
		if (stmt.length > 0) {
			let stmt2 = await otherDB.query(
				"SELECT * FROM `profile_status` WHERE user_name = :userid",
				{
					replacements: { userid: req.logedINUser },
					type: invtDB.QueryTypes.SELECT,
				}
			);
			let lastname, lastmobile, lastemail, namechange_count;
			if (stmt2.length > 0) {
				if (stmt2[0].last_name_change_dt == "--") {
					lastname = "--";
				} else {
					lastname = moment(stmt2[0].last_name_change_dt)
						.tz("Asia/Kolkata")
						.format("DD-MM-YYYY hh:mm A");
				}
				if (stmt2[0].last_mobile_change_dt == "--") {
					lastmobile = "--";
				} else {
					lastmobile = moment(stmt2[0].last_mobile_change_dt)
						.tz("Asia/Kolkata")
						.format("DD-MM-YYYY hh:mm A");
				}
				if (stmt2[0].last_email_change_dt == "--") {
					lastemail = "--";
				} else {
					lastemail = moment(stmt2[0].last_email_change_dt)
						.tz("Asia/Kolkata")
						.format("DD-MM-YYYY hh:mm A");
				}

				namechange_count = stmt2[0].name_change_count;
			} else {
				lastname = "Not Updated..";
				lastmobile = "Not Updated..";
				lastemail = "Not Updated..";
				namechange_count = "0";
			}
			return res.json({

				status: "success", success: true,
				data: {
					name: stmt[0].user_name,
					email: stmt[0].Email_ID,
					phone: stmt[0].Mobile_No,
					username: stmt[0].CustID,
					type: stmt[0].type.toUpperCase(),
					lastpassword_change: stmt[0].update_date,
					lastname_change: lastname,
					lastemail_change: lastemail,
					lastmobile_change: lastmobile,
					namechange_count: namechange_count,
				},
			});
		} else {
			return res.json({

				message: "account is misconfigured",
				status: "error", success: false,
			});
		}
	} catch (error) {
	    return helper.errorResponse(res, error);
	}
});

// SAVE NAME CHANGE
router.post("/userUpdate", [auth.isAuthorized], async (req, res) => {
	// START TRANSACTION
	const t = await invtDB.transaction();
	const transactionOt = await otherDB.transaction();
	try {
		let stmt1 = await invtDB.query(
			"SELECT * FROM `admin_login` WHERE `CustID` = :userid",
			{
				replacements: { userid: req.logedINUser },
				type: invtDB.QueryTypes.SELECT,
			}
		);
		if (stmt1.length > 0) {
			let stmt2 = await otherDB.query(
				"SELECT * FROM `profile_status` WHERE user_name = :userid",
				{
					replacements: { userid: req.logedINUser },
					type: invtDB.QueryTypes.SELECT,
				}
			);
			if (stmt2.length > 0) {
				if (stmt2[0].name_change_count == "2") {
					t.rollback();
					transactionOt.rollback();
					return res.json({

						message: "You have exceeded the maximum number of name changes",
						status: "error", success: false,
					});
				} else {
					let stmt3 = await invtDB.query(
						"UPDATE `admin_login` SET `user_name` = :newname WHERE `CustID` = :userid",
						{
							replacements: {
								userid: req.logedINUser,
								newname: req.body.fullname,
							},
							type: invtDB.QueryTypes.UPDATE,
							transaction: t,
						}
					);
					if (stmt3.length > 0) {
						let stmt4 = await otherDB.query(
							"UPDATE `profile_status` SET `name_change_count` = `name_change_count` + 1, `last_name_change` = :oldname, `last_name_change_dt` = :date WHERE user_name = :userid",
							{
								replacements: {
									oldname: stmt1[0].user_name,
									userid: req.logedINUser,
									date: moment().format("YYYY-MM-DD HH:mm:ss"),
								},
								type: invtDB.QueryTypes.INSERT,
								transaction: transactionOt,
							}
						);
						if (stmt4.length > 0) {
							t.commit();
							transactionOt.commit();
							return res.json({

								message:
									"username updated successfully, please loggin again to see the changes on dashboard",
								status: "success", success: true,
							});
						} else {
							t.rollback();
							transactionOt.rollback();
							return res.json({

								message: "an error occured while updating your name (3)",
								status: "error", success: false,
							});
						}
					} else {
						t.rollback();
						transactionOt.rollback();
						return res.json({

							message: "Internal Error<br/>If this condition persists, contact your system administrator",
							status: "error", success: false,
						});
					}
				}
			} else {
				let stmt5 = await invtDB.query(
					"UPDATE `admin_login` SET `user_name` = :newname WHERE `CustID` = :userid",
					{
						replacements: {
							userid: req.logedINUser,
							newname: req.body.fullname,
						},
						type: invtDB.QueryTypes.UPDATE,
						transaction: t,
					}
				);
				if (stmt5.length > 0) {
					let stmt6 = await otherDB.query(
						"INSERT INTO `profile_status` (`user_name`,`name_change_count`, `last_name_change`, `last_name_change_dt`) VALUES (:userid, 1, :oldname, :date)",
						{
							replacements: {
								userid: req.logedINUser,
								oldname: stmt1[0].user_name,
								date: moment().format("YYYY-MM-DD HH:mm:ss"),
							},
							type: invtDB.QueryTypes.INSERT,
							transaction: transactionOt,
						}
					);
					if (stmt6.length > 0) {
						t.commit();
						transactionOt.commit();
						return res.json({

							message:
								"username updated successfully, please loggin again to see the changes on dashboard",
							status: "success", success: true,
						});
					} else {
						t.rollback();
						transactionOt.rollback();
						return res.json({

							message: "an error occured while updating your name (2)",
							status: "error", success: false,
						});
					}
				} else {
					t.rollback();
					transactionOt.rollback();
					return res.json({

						message: "an error occured while updating your name (1)",
						status: "error", success: false,
					});
				}
			}
		} else {
			t.rollback();
			transactionOt.rollback();
			return res.json({

				message: "account is misconfigured..",
				status: "error", success: false,
			});
		}
	} catch (error) {
	    return helper.errorResponse(res, error);
	}
});

// CHANGE PASSWORD
router.post("/userChangePassword", [auth.isAuthorized], async (req, res) => {
	try {
		let stmt1 = await invtDB.query(
			"SELECT * FROM `admin_login` WHERE `CustID` = :userid",
			{
				replacements: { userid: req.logedINUser },
				type: invtDB.QueryTypes.SELECT,
			}
		);
		if (stmt1.length > 0) {
			if (stmt1[0].login_status !== "1") {
				return res.json({

					message: "account is not seem like in active status..",
					status: "error", success: false,
				});
			} else {
				if (req.body.oldpassword == "") {
					return res.json({

						message: "old password is required..",
						status: "error", success: false,
					});
				} else if (req.body.newpassword == "") {
					return res.json({

						message: "new password is required..",
						status: "error", success: false,
					});
				} else if (req.body.newpassword.length < 8) {
					return res.json({

						message: "new password must be atleast 8 characters long..",
						status: "error", success: false,
					});
				} else if (req.body.newpassword.length > 20) {
					return res.json({

						message: "new password must be less than 20 characters long..",
						status: "error", success: false,
					});
				} else if (req.body.oldpassword == req.body.newpassword) {
					return res.json({

						message: "new password must be different from old password..",
						status: "error", success: false,
					});
				} else if (stmt1[0].temp_password == req.body.newpassword) {
					return res.json({

						message: "new password must be different from temporary password..",
						status: "error", success: false,
					});
				} else {
					const oldpassword_hash = await bcrypt.compare(
						req.body.oldpassword,
						stmt1[0].Password
					);
					if (
						oldpassword_hash != false ||
						stmt1[0].temp_password == req.body.oldpassword
					) {
						if (stmt1[0].Attempt >= 6) {
							res.json({
								status: "error", success: false,
								message:
									"Your account has been deactivated for 3hrs due to (6) consecutive unsuccessful attempts",
								code: "500",
							});
							return;
						} else {
							const t = await invtDB.transaction();
							let stmt2 = await invtDB.query(
								"UPDATE `admin_login` SET `Password` = :newpassword, `temp_password` = :temp_pass, `Attempt` = '1', `update_date` = :date, `ask_change_password` = 'N' WHERE `CustID` = :userid",
								{
									replacements: {
										userid: req.logedINUser,
										temp_pass: Math.random().toString(36).slice(2, 10),
										newpassword: await bcrypt.hash(req.body.newpassword, 10),
										date: moment().format("dddd Do of MMMM YYYY hh:mm:ss A"),
									},
									type: invtDB.QueryTypes.UPDATE,
									transaction: t,
								}
							);
							if (stmt2.length > 0) {
								t.commit();
								sms.PasswordChange(
									"91" + stmt1[0].Mobile_No,
									"growthX",
									stmt1[0].CustID,
									"iot@mscorpres.in"
								);
								return res.json({

									message: "password updated successfully",
									status: "success", success: true,
									data: { update_date: stmt1[0].update_date },
								});
							} else {
								t.rollback();
								return res.json({

									message: "an error occured while updating your password",
									status: "error", success: false,
								});
							}
						}
					} else {
						return res.json({

							message: "old password is incorrect..<br/>(CASE IS SENSITIVE)",
							status: "error", success: false,
						});
					}
				}
			}
		} else {
			return res.json({

				message: "account is misconfigured",
				status: "error", success: false,
			});
		}
	} catch (error) {
	    return helper.errorResponse(res, error);
	}
});

// CHECK MOBILE NUMBER FOR OTP
router.get("/checkMobile", [auth.isAuthorized], async (req, res) => {
	try {
		let stmt1 = await invtDB.query(
			"SELECT * FROM `admin_login` WHERE `CustID` = :userid",
			{
				replacements: { userid: req.logedINUser },
				type: invtDB.QueryTypes.SELECT,
			}
		);
		if (stmt1.length > 0) {
			if (stmt1[0].isMobileConfirmed !== "1") {
				var intArr = Array.from(String(stmt1[0].Mobile_No), (num) =>
					Number(num)
				);
				return res.json({

					status: "success", success: true,
					data: {
						mobile:
							intArr[0].toString() +
							intArr[2].toString() +
							intArr[3].toString() +
							intArr[8].toString() +
							intArr[9].toString(),
					},
				});
			} else {
				return res.json({
					code: 403,
					message: "mobile number is already confirmed",
					data: { url: "https://ims.mscorpres.net/app/invt/dashboard/home" },
					status: "error", success: false,
				});
			}
		} else {
			return res.json({

				message: "account is misconfigured..",
				status: "error", success: false,
			});
		}
	} catch (error) {
	    return helper.errorResponse(res, error);
	}
});

// // SEND OTP TO MOBILE NUMBER VERIFICATION
router.post("/getMobileOTP", [auth.isAuthorized], async (req, res) => {
	const t = await invtDB.transaction();
	try {
		let stmt1 = await invtDB.query(
			"SELECT * FROM `admin_login` WHERE `CustID` = :userid",
			{
				replacements: { userid: req.logedINUser },
				type: invtDB.QueryTypes.SELECT,
			}
		);
		if (stmt1.length > 0) {
			if (stmt1[0].isMobileConfirmed !== "1") {
				if (stmt1[0].mobile_otp_data !== "--") {
					let jsonData = JSON.parse(stmt1[0].mobile_otp_data);
					if (
						moment(jsonData.otp_generated_dt, "YYYY-MM-DD HH:mm:ss").diff(
							moment(new Date(), "YYYY-MM-DD HH:mm:ss"),
							"minutes"
						) >= 0
					) {
						t.rollback();
						return res.json({

							message: "request for re-send OTP try after 1 minute",
							status: "error", success: false,
						});
					} else {
						if (jsonData.otp_count >= "3") {
							t.rollback();
							return res.json({

								message: "you have exceeded the maximum attempts..",
								status: "error", success: false,
							});
						}
						else {
							let otp_value = makeOTP(6);
							let otp_reference = makeReferenceID(6);
							var Arr1 = Array.from(String(stmt1[0].Mobile_No), (num) =>
								Number(num)
							);
							var Arr2 = Array.from(String(req.body.mobile), (num) =>
								Number(num)
							);
							[a = 0, b = 1, c = 2, d = 3, e = 4, f = 5, g = 6, h = 7, i = 8] =
								Arr1;
							if (
								b !== parseInt(Arr2[0]) ||
								e !== parseInt(Arr2[1]) ||
								f !== parseInt(Arr2[2]) ||
								g !== parseInt(Arr2[3]) ||
								h !== parseInt(Arr2[4])
							) {
								t.rollback();
								return res.json({

									message: "mobile number is not valid",
									status: "error", success: false,
								});
							} else {
								let stmt2 = await invtDB.query(
									"UPDATE `admin_login` SET `mobile_otp_data` = :data WHERE `CustID` = :userid",
									{
										replacements: {
											data: JSON.stringify({
												otp_generated_dt: moment(new Date())
													.tz("Asia/Kolkata")
													.format("YYYY-MM-DD HH:mm:ss"),
												otp_validity: moment(new Date())
													.add(10, "minutes")
													.tz("Asia/Kolkata")
													.format("YYYY-MM-DD HH:mm:ss"),
												otp_value: otp_value,
												otp_count: parseInt(jsonData.otp_count) + 1,
											}),
											userid: req.logedINUser,
										},
										type: invtDB.QueryTypes.UPDATE,
										transaction: t,
									}
								);

								if (stmt2.length > 0) {
									t.commit();
									sms.ChangeMobileNumber(
										"91" + stmt1[0].Mobile_No,
										"growthX",
										otp_reference,
										otp_value
									);
									return res.json({

										status: "success", success: true,
										message:
											"OTP has been sent to the number with unique reference ID : " +
											otp_reference,
									});
								} else {
									t.rollback();
									return res.json({

										message: "an error occured while sending OTP",
										status: "error", success: false,
									});
								}
							}
						}
					}
				} else {
					let otp_value = makeOTP(6);
					otp_reference = makeReferenceID(6);
					var Arr1 = Array.from(String(stmt1[0].Mobile_No), (num) =>
						Number(num)
					);
					var Arr2 = Array.from(String(req.body.mobile), (num) => Number(num));
					[a = 0, b = 1, c = 2, d = 3, e = 4, f = 5, g = 6, h = 7, i = 8] =
						Arr1;
					if (
						b !== parseInt(Arr2[0]) ||
						e !== parseInt(Arr2[1]) ||
						f !== parseInt(Arr2[2]) ||
						g !== parseInt(Arr2[3]) ||
						h !== parseInt(Arr2[4])
					) {
						t.rollback();
						return res.json({

							message: "mobile number is not valid",
							status: "error", success: false,
						});
					} else {
						let stmt2 = await invtDB.query(
							"UPDATE `admin_login` SET `mobile_otp_data` = :data WHERE `CustID` = :userid",
							{
								replacements: {
									data: JSON.stringify({
										otp_generated_dt: moment(new Date())
											.tz("Asia/Kolkata")
											.format("YYYY-MM-DD HH:mm:ss"),
										otp_validity: moment(new Date())
											.add(10, "minutes")
											.tz("Asia/Kolkata")
											.format("YYYY-MM-DD HH:mm:ss"),
										otp_value: otp_value,
										otp_count: "1",
									}),
									userid: req.logedINUser,
								},
								type: invtDB.QueryTypes.UPDATE,
								transaction: t,
							}
						);

						if (stmt2.length > 0) {
							t.commit();
							sms.ChangeMobileNumber(
								"91" + stmt1[0].Mobile_No,
								"growthX",
								otp_reference,
								otp_value
							);
							return res.json({

								status: "success", success: true,
								message:
									"OTP has been sent to the number with unique reference ID : " +
									otp_reference,
							});
						} else {
							t.rollback();
							return res.json({

								message: "an error occured while sending OTP",
								status: "error", success: false,
							});
						}
					}
				}
			} else {
				t.rollback();
				return res.json({
					code: 403,
					message: "mobile number is already confirmed",
					data: { url: "https://ims.mscorpres.net/app/dashboard/home" },
					status: "error", success: false,
				});
			}
		} else {
			t.rollback();
			return res.json({

				message: "account is misconfigured..",
				status: "error", success: false,
			});
		}
	} catch (error) {
	    return helper.errorResponse(res, error);
	}
});

// CHECK OTP  >> UPDATE AND VALIDITY
router.post("/checkMobileOTP", [auth.isAuthorized], async (req, res) => {
	const t = await invtDB.transaction();
	try {
		let stmt1 = await invtDB.query(
			"SELECT * FROM `admin_login` WHERE `CustID` = :userid",
			{
				replacements: { userid: req.logedINUser },
				type: invtDB.QueryTypes.SELECT,
			}
		);
		if (stmt1.length > 0) {
			if (stmt1[0].isMobileConfirmed !== "1") {
				if (stmt1[0].mobile_otp_data !== "--") {
					let jsonData = JSON.parse(stmt1[0].mobile_otp_data);
					if (
						moment(jsonData.otp_validity, "YYYY-MM-DD HH:mm:ss").diff(
							moment(new Date(), "YYYY-MM-DD HH:mm:ss"),
							"seconds"
						) <= 0
					) {
						t.rollback();
						return res.json({

							message: "OTP has been expired, please initiate the step's again",
							status: "error", success: false,
						});
					} else {
						if (jsonData.otp_value == Number(req.body.otp)) {
							let stmt2 = await invtDB.query(
								"UPDATE `admin_login` SET `mobile_otp_data` = '--', `isMobileConfirmed` = '1' WHERE `CustID` = :userid",
								{
									replacements: {
										userid: req.logedINUser,
									},
									type: invtDB.QueryTypes.UPDATE,
									transaction: t,
								}
							);

							if (stmt2.length > 0) {
								t.commit();
								return res.json({

									status: "success", success: true,
									message: "Mobile verification successfully done",
								});
							} else {
								t.rollback();
								return res.json({

									message: "an error occured while verifying mobile number",
									status: "error", success: false,
								});
							}
						} else {
							t.rollback();
							return res.json({

								message: "Invalid OTP entered : CASE SENSITIVE",
								status: "error", success: false,
							});
						}
					}
				} else {
					t.rollback();
					return res.json({

						message: "You haven't initiated the OTP generate processor..",
						status: "error", success: false,
					});
				}
			} else {
				t.rollback();
				return res.json({
					code: 403,
					message: "mobile number is already verified",
					data: { url: "https://ims.mscorpres.net/app/dashboard/home" },
					status: "error", success: false,
				});
			}
		} else {
			t.rollback();
			return res.json({

				message: "account is misconfigured..",
				status: "error", success: false,
			});
		}
	} catch (error) {
	    return helper.errorResponse(res, error);
	}
});

module.exports = router;
