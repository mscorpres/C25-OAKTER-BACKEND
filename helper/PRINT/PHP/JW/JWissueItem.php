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
    
    date_default_timezone_set('Asia/Kolkata');
    
    $browser = $_SERVER['HTTP_USER_AGENT'];
    
    require_once './../authConfig/alwarBackendConfig.php';
    require_once './../FUNCTIONS/my_function.php';
    require_once './../LIBRARIES/mpdf/vendor/autoload.php';
    
    $transactionid = trim(stripslashes(htmlspecialchars($_GET['transaction'])));
    $transactionid = preg_replace(['/\s{2,}/', '/[\t\n]/'], ' ', $transactionid);
    
    $sql_stmt = $con->prepare(
        "SELECT `jw_m_issue_qty`,`jw_m_job_id`,`jw_m_transaction_id`,`user_name`,`c_name`, `c_part_no`, DATE_FORMAT( `jw_m_insert_dt`, '%d-%m-%Y %H:%i') AS `jw_m_insert_dt` FROM `jw_material_issue` LEFT JOIN `admin_login` ON `jw_material_issue`.`jw_m_insert_by`=`admin_login`.`CustID` LEFT JOIN `components` ON `jw_material_issue`.`jw_m_component`=`components`.`component_key` WHERE `jw_m_status` = 'P' AND `jw_m_transaction_id` = :transaction_id  ORDER BY `components`.`c_part_no`"
    );
    $sql_stmt->execute([":transaction_id" => $transactionid]);
    
    if ($sql_stmt->rowCount() == 0) {
        $msg = ['status' => 'error', 'message' => 'an error while file generating...', 'code' => '500'];
        echo json_encode($msg);
        exit();
    }
    
    $data = $sql_stmt->fetchAll(PDO::FETCH_ASSOC);
    
    $header_data =
        '
        <tr style="width:100%;">
            <td style="width:50%;"><b>Requested By :- </b> ' .$data[0]['user_name'] .' </td>
            <td style="width:50%;"></td>
        </tr>
        <tr style="width:100%;">
            <td style="width:50%;"><b>Requested Date :- </b> ' .$data[0]['jw_m_insert_dt'] .' </td>
            <td style="width:50%;text-align:right;"><b>Transaction</b> :- ' .$data[0]['jw_m_transaction_id'] .'</td>
        </tr>
        <tr style="width:100%;">
            <td style="width:50%;"><b>JOB WORK ID :- </b> ' .$data[0]['jw_m_job_id'] .' </td>
            <td style="width:50%;text-align:right;"></td>
        </tr>';
    
    $table_row = "";
    $i = 1;
    foreach ($data as $row) {
        $table_row .=
            "<tr>
                <td style='border: 1px solid #999'>" .$i."</td>
                <td style='border: 1px solid #999'>" .$row['c_name']."</td>
                <td style='border: 1px solid #999'>" .$row['c_part_no']."</td>
                <td style='border: 1px solid #999'>" .$row['jw_m_issue_qty']."</td>
                <td style='border: 1px solid #999'>" .$row['mfgqty']."</td>
            </tr>";
        $i++;
    }
    
    $data = "";
    $data .='
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
                        font-family: VERDANA ;
                    }
                </style>
            </head>
            <body>
                <h3 style="text-align:center">JOBWORK REQUEST</h3>
                <table style="width:100%;position:relative;">' .$header_data.'</table>
                <br /><br /><br />
                <table style="width:100%;position:relative;border-collapse: collapse;border:1px solid #999">
                    <thead>
                        <tr style="background:#f5f5f5;">
                            <th style="border: 1px solid #999;text-align:left;">#</th>
                            <th style="border: 1px solid #999;width:250px;text-align:left;">Component</th>
                            <th style="border: 1px solid #999;width:250px;text-align:left;">Part</th>
                            <th style="border: 1px solid #999;text-align:left;">Req. QTY</th>
                            <th style="border: 1px solid #999;text-align:left;">Issue QTY</th>
                        </tr>
                    </thead>
                        <tbody>
                        '.$table_row.'
                        </tbody>
                    </table>
            </body>
        <html>';
    echo $data;
    exit();
