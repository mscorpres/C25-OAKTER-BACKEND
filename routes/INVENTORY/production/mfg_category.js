const express = require("express");
const router = express.Router();

let { invtDB, otherDB } = require("../../../config/db/connection");


const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");
const Validator = require("validatorjs");

// GET ALL INPUTS
router.get("/getInputs", [auth.isAuthorized], async (req, res) => {
    try {

        const stmt = await invtDB.query("SELECT inp_type as type FROM mfg_category_inputs", {
            type: invtDB.QueryTypes.SELECT
        });

        if (stmt.length > 0) {
            return res.json({ status: "success", success: true, message: stmt });
        }
        else {
            return res.json({ status: "error", success: false, message: "No data found" });
        }

    }
    catch (err) {
        return res.json({ status: "error", success: false, message: "Internal Error!!! If this condition persists, contact your system administrator", ...(process.env.NODE_ENV === 'development' && { debug: err.stack }) });
    }
});

// GET ATTRIBUTES LIST
router.get("/getAttributes", [auth.isAuthorized], async (req, res) => {
    try {
        const stmt = await invtDB.query("SELECT attr_name as text , attr_key as id , attr_type as inp_type FROM rm_cat_attrs", {
            type: invtDB.QueryTypes.SELECT
        });

        if (stmt.length > 0) {
            return res.json({ status: "success", success: true, data: stmt });
        }
        else {
            return res.json({ status: "error", success: false, message: "No data found" });
        }

    }
    catch (err) {
        return res.json({ status: "error", success: false, message: "Internal Error!!! If this condition persists, contact your system administrator", ...(process.env.NODE_ENV === 'development' && { debug: err.stack }) });
    }
});

// GET ATTRIBUTE LIST BY CATEGORY
router.post("/getAttributeListByCategory", [auth.isAuthorized], async (req, res) => {
    try {
        const valid = new Validator(req.body, {
            category: "required",
        });

        if (valid.fails()) {
            return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(valid) });
        }

        const attributeList = await invtDB.query("SELECT  attr_name as text , attr_key as id , attr_type as inp_type , 'false' as hasValue FROM rm_cat_attrs WHERE FIND_IN_SET (:category, category_key ) > 0", {
            replacements: { category: req.body.category },
            type: invtDB.QueryTypes.SELECT,
        });

        if (attributeList.length === 0) {
            return res.json({ status: "error", success: false, message: "No attributes found for the provided category" });
        }

        if (req.body.category == "348423983543") {
            const data = [];
            for (let i = 0; i < attributeList.length; i++) {
                if (attributeList[i].text == "frequency" || attributeList[i].text == "current_SI_Unit" || attributeList[i].text == "dc_resistance") {
                    data.push({ text: attributeList[i].text, id: attributeList[i].id, inp_type: attributeList[i].inp_type, hasValue: "true" });
                } else {
                    data.push({ text: attributeList[i].text, id: attributeList[i].id, inp_type: attributeList[i].inp_type, hasValue: attributeList[i].hasValue });
                }
            }
            return res.json({ status: "success", success: true, message: "Data fetched successfully", data: data });
        }

        return res.json({ status: "success", success: true, message: "Data fetched successfully", data: attributeList });
    } catch (err) {
        return helper.errorResponse(res, err);
    }
});

// GET ATTRIBUTE VALUE
router.post("/getAttributeValue", [auth.isAuthorized], async (req, res) => {
    try {
        const valid = new Validator(req.body, {
            attribute: "required",
        });

        if (valid.fails()) {
            return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(valid) });
        }

        const stmt = await invtDB.query("SELECT attr_value , attr_id as code FROM rm_cat_attrs_value WHERE attr_key = :attr_key", {
            replacements: {
                attr_key: req.body.attribute
            },
            type: invtDB.QueryTypes.SELECT
        });

        if (stmt.length > 0) {
            return res.json({ status: "success", success: true, data: stmt });
        }
        else {
            return res.json({ status: "error", success: false, message: "No data found" });
        }

    }
    catch (err) {
        return res.json({ status: "error", success: false, message: "Internal Error!!! If this condition persists, contact your system administrator", ...(process.env.NODE_ENV === 'development' && { debug: err.stack }) });
    }
});

// CRAETE CATEGORY LIST
router.post("/createCategory", [auth.isAuthorized], async (req, res) => {
    try {

        const valid = new Validator(req.body, {
            category: "required",
            type: "required",
        });

        if (valid.fails()) {
            return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(valid) });
        }

        const stmt = await invtDB.query("INSERT INTO rm_categories (rm_cat_name , rm_cat_key , attr_type ) VALUES (:rm_cat_name , :rm_cat_key :rm_cat_type ) ", {
            replacements: {
                rm_cat_name: req.body.category,
                rm_cat_type: req.body.type,
                rm_cat_key: helper.getUniqueNumber()
            },
            type: invtDB.QueryTypes.INSERT
        });

        if (stmt.length > 0) {
            return res.json({ status: "success", success: true, message: "Category created successfully" });
        }
        else {
            return res.json({ status: "error", success: false, message: "No data found" });
        }

    }
    catch (err) {
        return res.json({ status: "error", success: false, message: "Internal Error!!! If this condition persists, contact your system administrator", ...(process.env.NODE_ENV === 'development' && { debug: err.stack }) });
    }
});

// LIST OF CATEGORIES
router.get("/listCategories", [auth.isAuthorized], async (req, res) => {
    try {
        const stmt = await invtDB.query("SELECT rm_cat_name as text , rm_cat_key as value FROM rm_categories", {
            type: invtDB.QueryTypes.SELECT
        });

        if (stmt.length > 0) {
            return res.json({ status: "success", success: true, message: "Data fetched successfully", data: stmt });
        }
        else {
            return res.json({ status: "error", success: false, message: "No data found" });
        }

    }
    catch (err) {
        return res.json({ status: "error", success: false, message: "Internal Error!!! If this condition persists, contact your system administrator", ...(process.env.NODE_ENV === 'development' && { debug: err.stack }) });
    }

});

// ADD CATEGORY DATA
router.post("/addCategoryData", [auth.isAuthorized], async (req, res) => {
    try {
        const validation = new Validator(req.body, {
            category: "required",
            attribute: "required",
            type: "required"
        });

        if (validation.fails()) {
            return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(validation) });
        }

        const stmt_check = await invtDB.query("SELECT * FROM rm_cat_master WHERE rm_cat_key = :rm_cat_key AND rm_cat_attr = :rm_cat_attr ", {
            replacements: {
                rm_cat_key: req.body.category,
                rm_cat_attr: req.body.attribute
            },
            type: invtDB.QueryTypes.SELECT
        });

        if (stmt_check.length > 0) {
            return res.json({ status: "error", success: false, message: "Data already exists for this category with same attribute!!!" });
        }

        const stmt = await invtDB.query("INSERT INTO rm_cat_master (rm_cat_key , rm_cat_attr , rm_cat_inp_type) VALUES (:rm_cat_key , :rm_cat_attr , :rm_cat_type) ", {
            replacements: {
                rm_cat_key: req.body.category,
                rm_cat_attr: req.body.attribute,
                rm_cat_type: req.body.type
            },
            type: invtDB.QueryTypes.INSERT
        });

        if (stmt.length > 0) {
            return res.json({ status: "success", success: true, message: "Data added successfully" });
        }
        else {
            return res.json({ status: "error", success: false, message: "No data found" });
        }

    }
    catch (err) {
        return res.json({ status: "error", success: false, message: "Internal Error!!! If this condition persists, contact your system administrator", ...(process.env.NODE_ENV === 'development' && { debug: err.stack }) });
    }
});

// GET CATEGORY DATA
router.post("/getCategoryData", [auth.isAuthorized], async (req, res) => {
    try {
        const valid = new Validator(req.body, {
            category: "required",
        });

        if (valid.fails()) {
            return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(valid) });
        }

        const stmt = await invtDB.query("SELECT * FROM rm_cat_master LEFT JOIN rm_cat_attrs ON rm_cat_attrs.attr_key = rm_cat_master.rm_cat_attr WHERE rm_cat_key = :rm_cat_key ", {
            replacements: { rm_cat_key: req.body.category },
            type: invtDB.QueryTypes.SELECT
        });

        const data = [];

        if (stmt.length > 0) {
            for (let i = 0; i < stmt.length; i++) {
                data.push({
                    inp_type: stmt[i].rm_cat_inp_type,
                    attr_key: stmt[i].attr_key,
                    attr_name: stmt[i].attr_name,
                });
            }
            return res.json({ status: "success", success: true, message: "Data fetched successfully", data: data });
        }
        else {
            return res.json({ status: "error", success: false, message: "No data found" });
        }

    }
    catch (err) {
        return res.json({ status: "error", success: false, message: "Internal Error!!! If this condition persists, contact your system administrator", ...(process.env.NODE_ENV === 'development' && { debug: err.stack }) });
    }
});

// CREATE RM CATEGORY
router.post("/createRmCategory", [auth.isAuthorized], async (req, res) => {

    const transaction = await invtDB.transaction();

    try {

        const validHeader = new Validator(req.body, {
            component: "required",
            category: "required",
        });

        if (validHeader.fails()) {
            await transaction.rollback();
            return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(validHeader) });
        }

        // const stmt_get_comp_category = await invtDB.query("SELECT * FROM components WHERE component_key = :component_key", {
        //     replacements: {
        //         component_key: Buffer.from(req.body.component, 'base64').toString('ascii'),
        //     },
        //     type: invtDB.QueryTypes.SELECT
        // });
        // if (stmt_get_comp_category.length <= 0) {
        //     return res.json({ status: "error", success: false, message: "Component not found" });
        // }

        // const comp_master_cat = stmt_get_comp_category[0].c_attr_category;

        // if (comp_master_cat == "--") {
        //     return res.json({ status: "error", success: false, message: "Component category not found!!!" });
        // }

        const comp_master_cat = req.body.category;

        const stmt_get_category = await invtDB.query("SELECT * FROM rm_categories WHERE rm_cat_key = :rm_cat_key", {
            replacements: {
                rm_cat_key: comp_master_cat,
            },
            type: invtDB.QueryTypes.SELECT
        });

        if (stmt_get_category.length <= 0) {
            await transaction.rollback();
            return res.json({ status: "error", success: false, message: "Category not found" });
        }

        // UPDATE ONLY CATEGORY IF OTHER

        const stmt_category_update = await invtDB.query("UPDATE components SET c_attr_category = :category WHERE component_key = :component_key", {
            replacements: {
                component_key: Buffer.from(req.body.component, 'base64').toString('ascii'),
                category: req.body.category
            },
            type: invtDB.QueryTypes.UPDATE,
            transaction: transaction
        });

        if (req.body.category == "348423984423") {
            await transaction.commit();
            return res.json({ status: "success", success: true, message: "Category updated successfully" });
        }

        // END UPDATE ONLY CATEGORY


        // UNIQUE CODE
        let unique_code = "";

        let prefix = "";
        let mounting = "";
        let package = "";
        let tolerance = "";
        let power_rating = "";
        let value = req.body.value;

        // FOR RES CATEGORY
        if (stmt_get_category[0].rm_category_code == "RES") {
            const valid_res = new Validator(req.body, {
                multiplier: "required",
                mounting_style: "required",
                package_size: "required",
                value: "required",
                tolerance: "required",
                power_rating: "required",
            });

            if (valid_res.fails()) {
                await transaction.rollback();
                return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(valid_res) });
            }

            prefix = "RES";

            //         ["mounting" , "package" , "tolerance" , "power_rating" ];
            const attr = ["12312", "434092", "89768575", "7876567"];
            for (let i = 0; i < attr.length; i++) {

                const stmt_attr_data = await invtDB.query("SELECT * FROM rm_cat_attrs WHERE attr_key = :rm_cat_attr", {
                    replacements: {
                        rm_cat_attr: attr[i],
                    },
                    type: invtDB.QueryTypes.SELECT
                });
                // parseInt(stmt_attr_data[0].attr_code_len)

                let attr_value = "";

                if (i == 0) { attr_value = req.body.mounting_style }
                if (i == 1) { attr_value = req.body.package_size }
                if (i == 2) { attr_value = req.body.tolerance }
                if (i == 3) { attr_value = req.body.power_rating }

                const stmt_attr_value = await invtDB.query("SELECT * FROM rm_cat_attrs_value WHERE attr_key = :rm_cat_attr AND attr_value = :attr_value ", {
                    replacements: {
                        rm_cat_attr: attr[i],
                        attr_value: attr_value,
                    },
                    type: invtDB.QueryTypes.SELECT
                });

                if (stmt_attr_value.length > 0) {

                    if (i == 0) { mounting = stmt_attr_value[0].attr_id.toString().slice(0, parseInt(stmt_attr_data[0].attr_code_len)) }
                    if (i == 1) { package = stmt_attr_value[0].attr_id.toString().slice(0, parseInt(stmt_attr_data[0].attr_code_len)) }
                    if (i == 2) { tolerance = stmt_attr_value[0].attr_id.toString().slice(0, parseInt(stmt_attr_data[0].attr_code_len)) }
                    if (i == 3) { power_rating = stmt_attr_value[0].attr_id.toString().slice(0, parseInt(stmt_attr_data[0].attr_code_len)) }

                } else {
                    await transaction.rollback();
                    return res.json({ status: "error", success: false, message: "Code not found for ${stmt_attr_data[0].attr_name}" });
                }

            }
            unique_code = prefix + mounting + package + tolerance + power_rating + value

        }
        // END FOR RES

        // FOR CAPACITANCE
        if (stmt_get_category[0].rm_category_code == "CAP") {

            const valid_code_field = new Validator(req.body, {
                type_Of_capacitor: "required",
                voltage: "required",
                si_unit: "required",
                mounting_style: "required",
                package_size: "required",
                value: "required",
                tolerance: "required",
                power_rating: "required",
            });

            if (valid_code_field.fails()) {
                return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(valid_code_field) });
            }

            let prefix = "CAP";

            // ["mounting" , "type" , "package_size", "tolerance" , "voltage" ,  siunit ];
            const attr = ["12312", "49431234739", "434092", "89768575", "453940492", "574954523"];
            for (let i = 0; i < attr.length; i++) {

                const stmt_attr_data = await invtDB.query("SELECT * FROM rm_cat_attrs WHERE attr_key = :rm_cat_attr", {
                    replacements: {
                        rm_cat_attr: attr[i],
                    },
                    type: invtDB.QueryTypes.SELECT
                });

                let attr_value = "";

                if (i == 0) { attr_value = req.body.mounting_style }
                if (i == 1) { attr_value = req.body.type_Of_capacitor }
                if (i == 2) { attr_value = req.body.package_size }
                if (i == 3) { attr_value = req.body.tolerance }
                if (i == 4) { attr_value = req.body.voltage }
                if (i == 5) { attr_value = req.body.si_unit }

                const stmt_attr_value = await invtDB.query("SELECT * FROM rm_cat_attrs_value WHERE attr_key = :rm_cat_attr AND attr_value = :attr_value ", {
                    replacements: {
                        rm_cat_attr: attr[i],
                        attr_value: attr_value,
                    },
                    type: invtDB.QueryTypes.SELECT
                });

                if (stmt_attr_value.length > 0) {

                    if (i == 0) { mounting = stmt_attr_value[0].attr_id.toString().slice(0, parseInt(stmt_attr_data[0].attr_code_len)) }
                    if (i == 1) { type = stmt_attr_value[0].attr_id.toString().slice(0, parseInt(stmt_attr_data[0].attr_code_len)) }
                    if (i == 2) { package = stmt_attr_value[0].attr_id.toString().slice(0, parseInt(stmt_attr_data[0].attr_code_len)) }
                    if (i == 3) { tolerance = stmt_attr_value[0].attr_id.toString().slice(0, parseInt(stmt_attr_data[0].attr_code_len)) }
                    if (i == 4) { voltage = stmt_attr_value[0].attr_id.toString().slice(0, parseInt(stmt_attr_data[0].attr_code_len)) }
                    if (i == 5) { si_unit = stmt_attr_value[0].attr_id.toString().slice(0, parseInt(stmt_attr_data[0].attr_code_len)) }

                } else {
                    await transaction.rollback();
                    return res.json({ status: "error", success: false, message: "Code not found for ${stmt_attr_data[0].attr_name}" });
                }

            }

            unique_code = prefix + mounting + type + package + tolerance + voltage + value + si_unit;

        }

        if (unique_code == "") {
            await transaction.rollback();
            return res.json({ status: "error", success: false, message: "Code not generated!!! If this condition persists, contact your system administrator" });
        }

        // END UNIQUE CODE

        const stmt_check = await invtDB.query("SELECT * FROM rm_cat_comp WHERE rm_cat_component_id = :rm_cat_component_id ", {
            replacements: {
                rm_cat_component_id: Buffer.from(req.body.component, 'base64').toString('ascii'),
            },
            type: invtDB.QueryTypes.SELECT
        });

        if (stmt_check.length > 0) {

            await transaction.rollback();
            return res.json({ status: "error", success: false, message: "Component attribute already exists" });

            const stmt_update = await invtDB.query("UPDATE rm_cat_comp SET rm_cat_code = :rm_cat_code ,  mounting_style = :mounting_style ,  package_size = :package_size , value = :value , multiplier = :multiplier , tolerance = :tolerance , power_rating = :power_rating , correction = :correction , quantity = :quantity , location = :location , status = :status , type_Of_capacitor = :type_Of_capacitor , 	voltage = :voltage , si_unit = :si_unit , rm_cat_update_dt = :rm_cat_update_dt , rm_cat_update_by = :rm_cat_update_by WHERE rm_cat_component_id = :rm_cat_component_id", {
                replacements: {
                    rm_cat_component_id: Buffer.from(req.body.component, 'base64').toString('ascii'),
                    rm_cat_code: unique_code,
                    mounting_style: req.body.mounting_style,
                    package_size: req.body.package_size,
                    value: req.body.value,
                    multiplier: req.body.multiplier,
                    tolerance: req.body.tolerance,
                    power_rating: req.body.power_rating,
                    correction: req.body.correction,
                    quantity: req.body.quantity,
                    location: req.body.location,
                    status: req.body.status,
                    type_Of_capacitor: req.body.type_Of_capacitor ?? "",
                    voltage: req.body.voltage ?? "",
                    si_unit: req.body.si_unit ?? "",

                    rm_cat_update_dt: moment(new Date()).format("YYYY-MM-DD HH:mm:ss"),
                    rm_cat_update_by: req.logedINUser,
                },
                transaction: transaction,
                type: invtDB.QueryTypes.UPDATE
            });


            if (stmt_update.length > 0) {
                return res.json({ status: "success", success: true, message: "Data has been successfully updated" });
            }
            else {
                return res.json({ status: "error", success: false, message: "Something went wrong to update!!!" });
            }

        } else {
            const stmt_insert = await invtDB.query("INSERT INTO rm_cat_comp ( rm_cat_component_id, rm_cat_code,  mounting_style, package_size, value, multiplier, tolerance, power_rating, correction, quantity, location, status, rm_cat_insert_dt, rm_cat_insert_by , type_Of_capacitor , voltage , si_unit) VALUES ( :rm_cat_component_id , :rm_cat_code , :mounting_style , :package_size , :value , :multiplier , :tolerance , :power_rating , :correction , :quantity , :location , :status , :rm_cat_insert_dt , :rm_cat_insert_by , :type_Of_capacitor , :voltage , :si_unit )", {
                replacements: {
                    rm_cat_component_id: Buffer.from(req.body.component, 'base64').toString('ascii'),
                    rm_cat_code: unique_code,
                    mounting_style: req.body.mounting_style,
                    package_size: req.body.package_size,
                    value: req.body.value,
                    multiplier: req.body.multiplier,
                    tolerance: req.body.tolerance,
                    power_rating: req.body.power_rating,
                    correction: req.body.correction,
                    quantity: req.body.quantity,
                    location: req.body.location,
                    status: req.body.status,
                    type_Of_capacitor: req.body.type_Of_capacitor ?? "",
                    voltage: req.body.voltage ?? "",
                    si_unit: req.body.si_unit ?? "",
                    rm_cat_insert_dt: moment(new Date()).format("YYYY-MM-DD HH:mm:ss"),
                    rm_cat_insert_by: req.logedINUser,
                },
                type: invtDB.QueryTypes.INSERT,
                transaction: transaction
            });

            if (stmt_insert.length > 0) {
                await transaction.commit();
                return res.json({ status: "success", success: true, message: "Data added successfully", unique_code: unique_code });
            }
            else {
                await transaction.rollback();
                return res.json({ status: "error", success: false, message: "No data found" });
            }

        }


    }
    catch (err) {
        return res.json({ status: "error", success: false, message: "Internal Error!!! If this condition persists, contact your system administrator", ...(process.env.NODE_ENV === 'development' && { debug: err.stack }) });
    }


});

// GET ALL COMPONENT CATEGORY DATA
router.get("/getRmCategoryData", [auth.isAuthorized], async (req, res) => {
    try {
        const stmt = await invtDB.query("SELECT rm_cat_comp.* , components.c_name , components.c_part_no  FROM rm_cat_comp  LEFT JOIN components ON components.component_key = rm_cat_comp.rm_cat_component_id ", {
            type: invtDB.QueryTypes.SELECT
        });

        if (stmt.length > 0) {


            const data = [];
            for (let i = 0; i < stmt.length; i++) {
                data.push({
                    rm_cat_code: stmt[i].rm_cat_code,
                    c_name: stmt[i].c_name,
                    c_part_no: stmt[i].c_part_no,
                    mounting_style: {
                        id: "12312",
                        name: stmt[i].mounting_style
                    },
                    package_size: {
                        id: "434092",
                        name: stmt[i].package_size
                    },
                    value: {
                        id: "353453454",
                        name: stmt[i].value
                    },
                    multiplier: {
                        id: "65490895",
                        name: stmt[i].multiplier
                    },
                    tolerance: {
                        id: "89768575",
                        name: stmt[i].tolerance
                    },
                    power_rating: {
                        id: "7876567",
                        name: stmt[i].power_rating
                    },
                    correction: {
                        id: "455656",
                        name: stmt[i].correction
                    },
                    quantity: {
                        id: "345345",
                        name: stmt[i].quantity
                    },
                    location: {
                        id: "0798765",
                        name: stmt[i].location
                    },
                    status: {
                        id: "23443434",
                        name: stmt[i].status
                    }
                })
            }

            return res.json({ status: "success", success: true, message: "Data fetched successfully", data: data });
        }
        else {
            return res.json({ status: "error", success: false, message: "No data found" });
        }

    }
    catch (err) {
        return res.json({ status: "error", success: false, message: "Internal Error!!! If this condition persists, contact your system administrator", ...(process.env.NODE_ENV === 'development' && { debug: err.stack }) });
    }
});

// GET RM CATEGORY DATA
router.post("/getRmCategoryData", [auth.isAuthorized], async (req, res) => {
    try {

        let valid = new Validator(req.body, {
            component: "required",
        });

        if (valid.fails()) {
            return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(valid) });
        }

        const stmt = await invtDB.query("SELECT rm_cat_comp.* , components.c_name , components.c_part_no  FROM rm_cat_comp  LEFT JOIN components ON components.component_key = rm_cat_comp.rm_cat_component_id WHERE rm_cat_comp.rm_cat_component_id = :rm_cat_component_id", {
            replacements: {
                rm_cat_component_id: Buffer.from(req.body.component.toString(), 'base64').toString('ascii'),
            },
            type: invtDB.QueryTypes.SELECT
        });

        const data = [];
        if (stmt.length > 0) {

            for (let i = 0; i < stmt.length; i++) {
                data.push({
                    rm_cat_code: stmt[i].rm_cat_code,
                    c_name: stmt[i].c_name,
                    c_part_no: stmt[i].c_part_no,
                    mounting_style: {
                        id: "12312",
                        name: stmt[i].mounting_style
                    },
                    package_size: {
                        id: "434092",
                        name: stmt[i].package_size
                    },
                    value: {
                        id: "353453454",
                        name: stmt[i].value
                    },
                    multiplier: {
                        id: "65490895",
                        name: stmt[i].multiplier
                    },
                    tolerance: {
                        id: "89768575",
                        name: stmt[i].tolerance
                    },
                    power_rating: {
                        id: "7876567",
                        name: stmt[i].power_rating
                    },
                    correction: {
                        id: "455656",
                        name: stmt[i].correction
                    },
                    quantity: {
                        id: "345345",
                        name: stmt[i].quantity
                    },
                    location: {
                        id: "0798765",
                        name: stmt[i].location
                    },
                    status: {
                        id: "23443434",
                        name: stmt[i].status
                    },
                    type_Of_capacitor: {
                        id: "49431234739",
                        name: stmt[i].type_Of_capacitor
                    },
                    voltage: {
                        id: "453940492",
                        name: stmt[i].voltage
                    },
                    si_unit: {
                        id: "574954523",
                        name: stmt[i].si_unit
                    }
                })
            }

            return res.json({ status: "success", success: true, inputs: data[0] });
        }
        else {
            return res.json({ status: "success", success: true, message: "No data found" });
        }

    }
    catch (err) {
        return res.json({ status: "error", success: false, message: "Internal Error!!! If this condition persists, contact your system administrator", ...(process.env.NODE_ENV === 'development' && { debug: err.stack }) });
    }
});

// INSERT ATTRIBUTES VALUE , CODE , CODE LENGTH
router.post("/insertAttributesData", [auth.isAuthorized], async (req, res) => {
    try {

        const valid = new Validator(req.body, {
            attribute: "required",
            value: "required",
            code: "required",
        });

        if (valid.fails()) {
            return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(valid) });
        }

        // if (req.body.code.length != req.body.code_length) {
        //     return res.json({ status: "error", success: false, message: "Code length not matched" });
        // }

        const stmt_check = await invtDB.query("SELECT * FROM rm_cat_attrs_value WHERE attr_key = :attribute AND  (attr_value = :value OR attr_id = :code )  ", {
            replacements: {
                attribute: req.body.attribute,
                value: req.body.value,
                code: req.body.code
            },
            type: invtDB.QueryTypes.SELECT,
        });

        if (stmt_check.length > 0) {
            return res.json({ status: "error", success: false, message: "Data already exists" });
        }

        const stmt = await invtDB.query("INSERT INTO rm_cat_attrs_value ( attr_key , attr_value , attr_id , rm_cat_attrs_key , insert_by , 	insert_dt ) VALUE ( :attribute , :value , :attr_id , :attr_key , :insert_by , :insert_dt ) ", {
            replacements: {
                attribute: req.body.attribute,
                value: req.body.value,
                attr_id: req.body.code,
                attr_key: helper.getUniqueNumber(),
                insert_by: req.logedINUser,
                insert_dt: moment(new Date()).format("YYYY-MM-DD HH:mm:ss"),
            },
            type: invtDB.QueryTypes.INSERT,
        });

        return res.json({ status: "success", success: true, message: "Data has been successfully inserted" });

    }
    catch (err) {
        return res.json({ message: "Internal Error!!!If this condition persists, contact your system administrator", errors: err.stack, status: "error", success: false });
    }
});

// VEIW ATTRIBUTES DATA
router.post("/viewAttributesData", [auth.isAuthorized], async (req, res) => {
    try {

        const valid = new Validator(req.body, {
            attribute: "required",
        });

        if (valid.fails()) {
            return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(valid) });
        }

        const result = await invtDB.query("SELECT * FROM rm_cat_attrs_value WHERE attr_key = :attribute ", {
            replacements: {
                attribute: req.body.attribute
            },
            type: invtDB.QueryTypes.SELECT,
        });

        if (result.length > 0) {

            const data = [];

            for (let i = 0; i < result.length; i++) {
                data.push({
                    value: result[i].attr_value,
                    code: result[i].code,
                })
            }

            return res.json({ status: "success", success: true, message: "Data fetched successfully", data: data });
        } else {
            return res.json({ status: "error", success: false, message: "No data found" });
        }
    } catch (err) {
        return helper.errorResponse(res, err);
    }

});

// GET RM CATEGORY DATA
// router.post("/editRmCategoryData", [auth.isAuthorized], async (req, res) => {
//     try {

//         let valid = new Validator(req.body, {
//             component: "required",
//         });

//         if (valid.fails()) {
//             return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(valid) });
//         }

//         const stmt = await invtDB.query("SELECT rm_cat_comp.* , components.c_name , components.c_part_no , rm_categories.rm_cat_name , rm_cat_attrs.attr_name FROM rm_cat_comp LEFT JOIN components ON components.component_key = rm_cat_comp.rm_cat_component_id LEFT JOIN rm_categories ON rm_categories.rm_cat_key = rm_cat_comp.rm_cat_id  LEFT JOIN rm_cat_attrs ON rm_cat_attrs.attr_key = rm_cat_comp.rm_cat_attr  WHERE rm_cat_component_id = :rm_cat_component_id", {
//             replacements: {
//                 rm_cat_component_id: Buffer.from(req.body.component.toString(), 'base64').toString('ascii'),
//             },
//             type: invtDB.QueryTypes.SELECT
//         });

//         const data = [];
//         if (stmt.length > 0) {


//             const headers = {
//                 part_code: stmt[0].c_part_no,
//                 part_name: stmt[0].c_name,
//                 category: stmt[0].rm_cat_name,
//                 category_code: stmt[0].rm_cat_code,
//                 category_id: stmt[0].rm_cat_id
//             }

//             for (let i = 0; i < stmt.length; i++) {

//                 data.push({
//                     type: stmt[i].rm_cat_type,
//                     attribute: stmt[i].rm_cat_attr,
//                     attribute_name: stmt[i].attr_name,
//                     value: stmt[i].rm_cat_value
//                 })
//             }

//             return res.json({ status: "success", success: true, inputs: data, header: headers });
//         }
//         else {
//             return res.json({ status: "success", success: true, message: "No data found" });
//         }

//     }
//     catch (err) {
//         return res.json({ status: "error", success: false, message: "Internal Error!!! If this condition persists, contact your system administrator", ...(process.env.NODE_ENV === 'development' && { debug: err.stack }) });
//     }
// });

// UPDATE RM CATEGORY DATA
// router.post("/updateRmCategoryData", [auth.isAuthorized], async (req, res) => {
//     try {
//         const valid = new Validator(req.body.header, {
//             component: "required",
//             category: "required",
//             category_code: "required",
//         });

//         if (valid.fails()) {
//             return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(valid) });
//         }

//         const attrLength = req.body.inputs.attr.length;
//         const valueLength = req.body.inputs.value.length;

//         if (attrLength == 0 || valueLength == 0) {
//             return res.json({ status: "error", success: false, message: "Please fill all inputs" });
//         }

//         if (attrLength != valueLength) {
//             return res.json({ status: "error", success: false, message: "Please fill all inputs" });
//         }


//         for (let i = 0; i < attrLength; i++) {

//             const validInputs = new Validator({
//                 attribute: req.body.inputs.attr[i],
//                 value: req.body.inputs.value[i],
//             }, {
//                 attribute: "required",
//                 value: "required",
//             });

//             if (validInputs.fails()) {
//                 return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(validInputs) });
//             }

//         }
//     }
//     catch (err) {
//         return res.json({ status: "error", success: false, message: "Internal Error!!! If this condition persists, contact your system administrator", ...(process.env.NODE_ENV === 'development' && { debug: err.stack }) });
//     }

//     const transaction = await invtDB.transaction();

//     try {

//         const comp_id = Buffer.from(req.body.header.component.toString(), 'base64').toString('ascii');

//         const stmt_check_comp = await invtDB.query("SELECT * FROM rm_cat_comp WHERE rm_cat_component_id = :rm_cat_component_id", {
//             replacements: {
//                 rm_cat_component_id: comp_id,
//             },
//             type: invtDB.QueryTypes.SELECT
//         });
//         if (stmt_check_comp.length <= 0) {
//             await transaction.rollback();
//             return res.json({ status: "error", success: false, message: "Component category not found" });
//         }

//         for (let i = 0; i < req.body.inputs.attr.length; i++) {
//             const stmt_update = await invtDB.query("UPDATE rm_cat_comp SET rm_cat_value = :rm_cat_value , rm_cat_code = :rm_cat_code  WHERE rm_cat_component_id = :rm_cat_component_id AND rm_cat_attr = :rm_cat_attr", {
//                 replacements: {
//                     rm_cat_attr: req.body.inputs.attr[i],
//                     rm_cat_value: req.body.inputs.value[i],
//                     rm_cat_component_id: comp_id,
//                     rm_cat_code: req.body.header.category_code
//                 },
//                 type: invtDB.QueryTypes.UPDATE,
//                 transaction: transaction
//             });
//         }

//         const stmt_update_cat_code = await invtDB.query("UPDATE rm_cat_comp SET rm_cat_code = :rm_cat_code  WHERE rm_cat_component_id = :rm_cat_component_id", {
//             replacements: {
//                 rm_cat_component_id: comp_id,
//                 rm_cat_code: req.body.header.category_code
//             },
//             type: invtDB.QueryTypes.UPDATE,
//             transaction: transaction
//         });

//         await transaction.commit();
//         return res.json({ status: "success", success: true, message: "Data has been successfully updated" });

//     }
//     catch (err) {
//         await transaction.rollback();
//         return res.json({ status: "error", success: false, message: "Internal Error!!! If this condition persists, contact your system administrator", ...(process.env.NODE_ENV === 'development' && { debug: err.stack }) });
//     }

// });

module.exports = router