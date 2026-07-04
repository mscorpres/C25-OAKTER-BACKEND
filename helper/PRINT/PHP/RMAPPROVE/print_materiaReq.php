<?php
    header("Cache-Control: no-store, no-cache, must-revalidate, max-age=0");
    header("Cache-Control: post-check=0, pre-check=0", false);
    header("Pragma: no-cache");
    error_reporting(0); 
    //**********************************************//
    //FOR VIEWING ALL ERROR LOGS BELOW//
    // error_reporting(E_ALL);
    // ini_set('html_error', 0);
    // error_reporting(-1);
    // ini_set('display_errors', 'On');
    // ini_set('display_errors', 1);
    // ini_set('display_startup_errors', 1);
    //**********************************************//
    require_once('./../authConfig/alwarBackendConfig.php');
    require_once('./../FUNCTIONS/my_function.php');
    
    $transactionid = $_GET['transaction'];
    
    $sql_stmt = $con->prepare(
        "SELECT COALESCE(`p_name`, '--') AS `product_name`,`p_sku`,`req_remark`,`material_request`.`insert_date`,`req_debit`,`mfgqty`, `admin_login`.`user_name` ,`loc_name`,`c_part_no`,`c_name` FROM `material_request` LEFT JOIN `components` ON `material_request`.`components_key`=`components`.`component_key` LEFT JOIN `location_main` ON `material_request`.`location_id`=`location_main`.`location_key` LEFT JOIN `products` ON `material_request`.`product`=`products`.`p_sku` LEFT JOIN `admin_login` ON  `admin_login`.`CustID`= `material_request`.`inserted_by` WHERE `material_request`.`transaction_id` = :transaction_id ORDER BY `components`.`c_part_no` ASC"
    );
    $sql_stmt->execute([":transaction_id" => $transactionid]);
    $data = $sql_stmt->fetchAll(PDO::FETCH_ASSOC);
    
    $header_data =
        '
                    <tr style="width:100%;">
                        <td style="width:100%;text-align:center" colspan="2"><ul><h3>MATERIAL ISSUE REQUEST</h3></ul></td>
                    </tr>
                    <br/><br/>
                    <tr style="width:100%;">
                        <td style="width:50%;"><b>Requested By :- </b> ' .
        $data[0]['user_name'] .
        ' </td>
                        <td style="width:50%;"></td>
                    </tr>
                    <tr style="width:100%;">
                        <td style="width:50%;"><b>Requested Date :- </b> ' .
        date("d-m-Y", strtotime($data[0]['insert_date'])) .
        ' </td>
                        <td style="width:50%;text-align:right;"><b>TXN ID :- </b> ' .
        $transactionid .
        '</td>
                    </tr>
                    <tr style="width:100%;">
                        <td style="width:50%;"><b>SKU :- </b> ' .
        $data[0]['p_sku'] .
        ' </td>
                        <td style="width:50%;text-align:right;"><b>Req. Location :- </b> ' .
        $data[0]['loc_name'] .
        ' </td>
                    </tr>
                    <tr style="width:100%;">
                        <td style="width:50%;"><b>Product :- </b> ' .
        $data[0]['product_name'] .
        ' </td>
                        <td style="width:50%;text-align:right;"><b></b></td>
                    </tr>
                ';
    
    $table_row = "";
    $i = 1;
    foreach ($data as $row) {
        $table_row .=
            "
                    <tr>
                        <td style='border: 1px solid #999'>" .
            $i .
            "</td>
                        <td style='border: 1px solid #999'>" .
            $row['c_part_no'] .
            "</td>
                        <td style='border: 1px solid #999'>" .
            $row['c_name'] .
            "</td>
                        <td style='border: 1px solid #999'>" .
            $row['req_debit'] .
            "</td>
                        <td style='border: 1px solid #999'></td>
                    </tr>";
        $i++;
    }
    
    $data = "";
    $data .=
        '
                <!DOCTYPE html>
                <html lang="en">
                    <head>
                        <meta charset="UTF-8" />
                        <META HTTP-EQUIV="Pragma" CONTENT="no-cache">
                        <META HTTP-EQUIV="Expires" CONTENT="-1">
                        <style>
                            *{
                                margin: 0;
                                padding: 0;
                            }
                            body{
                                font-family:verdana;
                                font-size: 13px;
                            }
                            
                            th, td {
                              padding: 5px;
                            }
                        </style>
                    </head>
                    <body style="padding:20px" >
                        <table style="width:100%;position:relative;">
                            ' .
        $header_data .
        '
                        </table>
                        <br />
                        <table style="width:100%; position:relative; border-collapse: collapse; border:1px solid #999; text-align: left;">
                        <thead>
                            <tr style="background:#f5f5f5;">
                                <th style="border: 1px solid #999">#</th>
                                <th style="border: 1px solid #999">Part</th>
                                <th style="border: 1px solid #999">Component</th>
                                <th style="border: 1px solid #999">Req. Qty.</th>
                                <th style="border: 1px solid #999">Issue Qty.</th>
                            </tr>
                        </thead>
                        <tbody>
                        ' .
        $table_row .
        '
                        </tbody>
                    </table>
                </body>
                <html>';
    
    echo $data;
    
    exit();
?>    