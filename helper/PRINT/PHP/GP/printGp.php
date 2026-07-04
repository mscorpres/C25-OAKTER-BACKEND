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
    
    require_once './../authConfig/alwarBackendConfig.php';
    require_once './../FUNCTIONS/my_function.php';
    
    $gatepass_id = $_GET['journal'];
    
    $copyright = date('Y') > 2020 ? ' - ' . date('Y') : '';
    
    // HEADER DETAILS
    $sql = $con->prepare("SELECT * FROM `ims_gatepass` LEFT JOIN `admin_login` ON `ims_gatepass`.`gp_insert_by` = `admin_login`.`CustID` WHERE `gp_journal_id` = :journalKey");
    $sql->execute([':journalKey' => $gatepass_id]);
    if ($sql->rowCount() > 0) {
        while ($result = $sql->fetch(PDO::FETCH_ASSOC)) {
            $pass_type = $result['gp_type'];
            $username = $result['gp_name'];
            if ($result['gp_mobile'] !== '--') {
                $mobile = $result['gp_mobile'];
            } else {
                $mobile = 'Not Available';
            }
            if ($result['gp_email'] !== '--') {
                $email = $result['gp_email'];
            } else {
                $email = 'Not Available';
            }
            if ($result['gp_address'] !== '--' && $result['gp_address'] !== '') {
                $address = $result['gp_address'];
            } else {
                $address = 'Not Available';
            }
            if ($result['gp_narration'] !== '--') {
                $narration = $result['gp_narration'];
            } else {
                $narration = 'Not Available';
            }
            $issue_date = date('d-m-Y', strtotime($result['gp_insert_dt']));
            $issue_by = $result['user_name'];
    
            if ($result['gp_checkout_dt'] == '--') {
                $out_status = '________________________________________';
            } else {
                $out_status = date('d-m-Y', strtotime($result['gp_checkout_dt']));
            }
        }
    } else {
        exit("no any Gate Pass founded!");
    }
    
    $header =
        '<table autosoize="1" autosoize="1" style="width: 100%; margin-bottom:10px; border-collapse: collapse; font-family: verdana;">
                <tr>
                    <td style="text-align: left;"><h3>GATE PASS</h3></td>
                    <td style="font-size: 10px; vertical-align: top; text-align: right;">
                        <strong>Riot Labz Private Limited</strong>
                        <p>A-21, Hosiery Complex, Block A Road,<br>Noida Phase-2,<br>Yakubpur, Noida, (UP) - 201305</p>
                    </td>
                </tr>
            </table>
            <table border="1" autosoize="1" cellpadding="5" style="width: 100%; border-collapse: collapse; font-family: verdana;">
                <tr>
                    <td colspan="5" rowspan="2" style="text-align: left; vertical-align: text-top; font-size: 10px; width: 50%;">
                        <strong style="font-size: 12px;"><strong>To:</strong> ' .
        $username .
        '</strong><br /><br />
                        Address: ' .
        $address .
        '.<br /><br />Mobile No. +91 ' .
        $mobile .
        '<br />Email Id:' .
        $email .
        '
                    </td>
                    <td colspan="3" style="font-size: 10px; vertical-align: top; text-align: left;">
                        Issue date:<br />
                        <strong>' .
        $issue_date .
        '</strong>
                        <hr>
                        Issue By.<br />
                        <strong>' .
        $issue_by .
        '</strong>
                    </td>
                    <td colspan="3" style="font-size: 10px; vertical-align: top; text-align: left;">
                        Serial No: : <strong>' .
        $gatepass_id .
        '</strong>
                        <hr><br />
                        <strong>' .
        $pass_type .
        '</strong>
                    </td>
                </tr>
                <tr>
                    <td colspan="6" style="vertical-align: top; font-size: 10px; text-align: left; width: 50%;">
                        <p><strong>Remark : </strong>' .
        $narration .
        '</p>
                    </td>
                </tr>
            </table>';
    
    // BASIC DETAILS
    $results_per_page = 20;
    
    $stmt = $con->prepare("SELECT * FROM `ims_gatepass` WHERE `gp_journal_id` = :journalKey");
    $stmt->execute([':journalKey' => $gatepass_id]);
    
    $number_of_result = $stmt->rowCount();
    $number_of_page = ceil($number_of_result / $results_per_page);
    
    $body = "";
    $count = 0;
    $slr_no = 1;
    $sum_of_qty = 0;
    while ($number_of_page > $count) {
        if ($count + 1 >= $number_of_page) {
            $page_end = '<p style="text-align:center; font-family: verdana; font-size: 10px">.: The End of the Gate Pass :.</p>';
        } else {
            $page_end = '<p style="text-align:right; font-family: verdana; font-size: 10px">... to be continued on page no. ' . ($count + 2) . '</p> <pagebreak/>';
        }
    
        $my_custom_limit = $count * $results_per_page;
        $sql = $con->prepare(
            "SELECT * FROM `ims_gatepass` LEFT JOIN `components` ON `ims_gatepass`.`gp_part_code` = `components`.`component_key` LEFT JOIN `units` ON `units`.`units_id` = `components`.`c_uom` WHERE `ims_gatepass`.`gp_journal_id` = :journalKey ORDER BY `components`.`c_name` ASC LIMIT $my_custom_limit,$results_per_page"
        );
        $sql->execute([':journalKey' => $gatepass_id]);
        $result = $sql->fetchAll();
    
        $body .=
            $header .
            '<table border="1" autosize="1" cellpadding="5" style="margin-top: 1.5px; width: 100%; border-collapse: collapse; font-family: verdana;"><tr><td style="font-size: 12px;border-bottom:1px solid #000;border-left:1px solid #000" height="39" align="left" valign="middle" bgcolor="#D8D8D8"><strong><font face="Courier New" color="#000000">SL<br />No.</font></strong></td><td style="font-size: 12px;border-bottom:1px solid #000;border-left:1px solid #000" colspan="8" align="left" valign="middle" bgcolor="#D8D8D8"><strong><font face="Courier New" color="#000000">Particulars</font></strong></td><td style="font-size: 12px; border-bottom:1px solid #000;border-left:1px solid #000" align="center" valign="middle" bgcolor="#D8D8D8"><strong><font face="Courier New" color="#000000">Qty</font></strong></td></tr>';
    
        foreach ($result as $row) {
            if ($row['gp_part_remark'] == "") {
                $remark = '';
            } else {
                $remark = '<br/>&nbsp;&nbsp;&nbsp;<i><span style="font-size: 8px;">: ' . $row['gp_part_remark'] . '</span></i>';
            }
            $body .=
                '
                    <tr>
                        <td width="5%" align="left" valign="middle" style="font-size: 10px; border-top: 0px;border-bottom: 0px;">' .
                $slr_no .
                '</td>
                        <td align="left" valign="middle" colspan="8" style="font-size: 10px; border-top: 0px;border-bottom: 0px;">' .
                $row['c_part_no'] .
                ' / ' .
                $row['c_name'] .
                $remark .
                '</td>
                        <td align="left" valign="middle" style="font-size: 10px; border-top: 0px;border-bottom: 0px;">' .
                $row['gp_pass_qty'] .
                ' ' .
                $row['units_name'] .
                '</td>
                    </tr>';
            $slr_no = $slr_no + 1;
            $sum_of_qty += $row['gp_pass_qty'];
        }
        if ($count + 1 >= $number_of_page) {
            $body .=
                '
                    <tr>
                        <td align="left" height="20" valign="middle" style="border-top: 0px; border-bottom: 0px;"></td>
                        <td align="left" height="20" valign="middle" colspan="8" style="border-top: 0px; border-bottom: 0px;"></td>
                        <td align="left" height="20" valign="middle" style="border-right: 1px solid #000000; border-top: 0px; border-bottom: 0px;"></td>
                    </tr>
                    <tr>
                        <td colspan="10"></td>
                    </tr>
                    
                    <tr>
                        <td height="30" style="font-size: 10px; border-bottom:0px; border-top:0px solid #000000; border-left: 1px solid #000000; border-right: 0px" colspan="3">Time Out: </td>
                        <td height="30" style="font-size: 10px; border-bottom:0px; border-top:0px solid #000000; border-left: 0px; border-right: 0px;">' .
                $out_status .
                '</td>
                        <td height="30" style="font-size: 10px; border-bottom:0px; border-top:0px solid #000000; border-left: 1px solid #000000; border-right: 0px" colspan="3"></td>
                        <td height="30" style="font-size: 10px; border-bottom:0px; border-top:0px solid #000000; border-left: 1px solid #000000; border-right: 1px solid #000000;" colspan="3"></td>
                    </tr>
                    <tr>
                        <td height="30" style="font-size: 10px; border-top:0px solid #000000; border-left: 1px solid #000000; border-right: 0px" colspan="4">Receiver Signature </td>
                        <td height="30" style="font-size: 10px; border-bottom:1px solid #000000; border-top:0px; border-left: 1px solid #000000; border-right: 0px" colspan="3">Approved By</td>
                        <td height="30" style="font-size: 10px; border-bottom:1px solid #000000; border-top:0px; border-left: 1px solid #000000; border-right: 1px solid #000000; text-align:center" colspan="3">Security</td>
                    </tr>
                </table>' .
                $page_end;
        } else {
            $body .=
                '
                    
                    </table>' . $page_end;
        }
        $count++;
    }
    
    // END GATEPASS
    echo $body;
    exit();

?>
