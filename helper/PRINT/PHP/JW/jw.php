<?php
    header("Cache-Control: no-store, no-cache, must-revalidate, max-age=0");
    header("Cache-Control: post-check=0, pre-check=0", false);
    header("Pragma: no-cache");
    ini_set('session.use_strict_mode', 1);
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
    require_once './../LIBRARIES/mpdf/vendor/autoload.php';

    $jobwork_id = $_GET['invoice'];
    $material_issue_ref_id = $_GET['refid'];
        
        
    function amount_in_digit(float $amount) {
            $amount_after_decimal = round($amount - ($num = floor($amount)), 2) * 100;
            $amt_hundred = null;
            $count_length = strlen($num);
            $x = 0;
            $string = [];
            $change_words = [
                0 => '',
                1 => 'One',
                2 => 'Two',
                3 => 'Three',
                4 => 'Four',
                5 => 'Five',
                6 => 'Six',
                7 => 'Seven',
                8 => 'Eight',
                9 => 'Nine',
                10 => 'Ten',
                11 => 'Eleven',
                12 => 'Twelve',
                13 => 'Thirteen',
                14 => 'Fourteen',
                15 => 'Fifteen',
                16 => 'Sixteen',
                17 => 'Seventeen',
                18 => 'Eighteen',
                19 => 'Nineteen',
                20 => 'Twenty',
                30 => 'Thirty',
                40 => 'Forty',
                50 => 'Fifty',
                60 => 'Sixty',
                70 => 'Seventy',
                80 => 'Eighty',
                90 => 'Ninety',
            ];
            $here_digits = ['', 'Hundred', 'Thousand', 'Lakh', 'Crore'];
            while ($x < $count_length) {
                $get_divider = $x == 2 ? 10 : 100;
                $amount = floor($num % $get_divider);
                $num = floor($num / $get_divider);
                $x += $get_divider == 10 ? 1 : 2;
                if ($amount) {
                    $add_plural = ($counter = count($string)) && $amount > 9 ? 's' : null;
                    $amt_hundred = $counter == 1 && $string[0] ? ' and ' : null;
                    $string[] =
                        $amount < 21
                            ? $change_words[$amount] .
                                ' ' .
                                $here_digits[$counter] .
                                $add_plural .
                                ' 
                           ' .
                                $amt_hundred
                            : $change_words[floor($amount / 10) * 10] .
                                ' ' .
                                $change_words[$amount % 10] .
                                ' 
                           ' .
                                $here_digits[$counter] .
                                $add_plural .
                                ' ' .
                                $amt_hundred;
                } else {
                    $string[] = null;
                }
            }
            $implode_to_Rupees = implode('', array_reverse($string));
            $get_paise =
                $amount_after_decimal > 0
                    ? "& " .
                        ($change_words[$amount_after_decimal / 10] .
                            " 
                       " .
                            $change_words[$amount_after_decimal % 10]) .
                        ' Paise'
                    : '';
            return ($implode_to_Rupees ? $implode_to_Rupees . ' Only ' : '') . $get_paise;
        }
        
        
    // HEADER DETAILS
    $sql = $con->prepare("SELECT * FROM `jw_material_challan` WHERE `jw_transaction` = :transaction_id AND `jw_challan_ref_id` = :refid LIMIT 1");
    $sql->execute(array(':transaction_id' => $jobwork_id, ':refid' => $material_issue_ref_id));
    if ($sql->rowCount() > 0) {
            $result = $sql->fetch(PDO::FETCH_ASSOC);
            $vehicle_no = $result['jw_vehicle'];
                
            $billing_address_id = $result['jw_billing_id'];
            $billing_address = $result['jw_billing_address'];
                
            $vendor_branch_code = $result['jw_ven_add_id'];
            $dispatch_to_addr = $result['jw_vendor_address'];
                    
            $nature_of_process = $result['jw_nature_process'];
            $duration_of_payment = $result['jw_duration_process'];
            $other_ref = $result['jw_other_ref'];
                    
            $challan_id = $result['jw_challan_txn_id'];
            $jw_transaction_id = $result['jw_transaction'];
            $jw_reg_date = date("d-M-Y", strtotime($result['jw_insert_dt']));
                
            $dispatch_from = $result['jw_dispatch_to_id'];
            $dispatch_from_addr_1 = $result['jw_dispatch_to__line1'];
            $dispatch_from_addr_2 = $result['jw_dispatch_to__line2'];
            $dispatch_from_state_code = $result['jw_dispatch_to_state_code'];
            $dispatch_from_pin_code = $result['jw_dispatch_to_pincode'];
            
        $stmt = $con->prepare("SELECT * FROM `billing_address` LEFT JOIN `state_code` ON `billing_address`.`billing_state` = `state_code`.`state_code` WHERE `billing_address`.`billing_code` = :code");
        $stmt->execute(array(':code' => $billing_address_id));
        
        if($stmt->rowCount() > 0) {
            while($data = $stmt->fetch()) {
                $billing_company = $data['billing_company'];
                $billing_address_1 = $data['billing_address'];
                $billing_gstid = $data['billing_gstno'];
                $billing_panno = $data['billing_pan'];
                $billing_cin = $data['billing_cin'];
                $billing_state_code = $data['billing_state'];
                $billing_state_name = $data['state_name'];
            }
            
        } else {
            exit("Billing address configuration error..");
        }
        
        if($billing_address !== "") {
            $billing_address = $billing_address;
        } else {
            $billing_address = $billing_address_1;
        }
        
        //DISPATCH FROM // SHIPMENT FROM
        $stmt = $con->prepare("SELECT * FROM `dispatch_address` WHERE `dispatch_code` = :dispatch_id");
        $stmt->execute(array(':dispatch_id' => $dispatch_from));
        if ($stmt->rowCount() > 0) {
            while ($data = $stmt->fetch(PDO::FETCH_ASSOC)) {
                $dispatch_from_company = $data['dispatch_company'];
                $dispatch_from_company_gst_id = $data['dispatch_gstin'];
                $dispatch_from_addr = $data['dispatch_address'];
                $dispatch_from_state_code = $data['dispatch_state_code'];
                $dispatch_from_state_name = $data['dispatch_state'];
                $dispatch_from_pin_code = $data['dispatch_pincode'];
            }
        } 
        
        //DISPATCH TO // SHIPMENT TO
        if($dispatch_to_addr !== "") {
            $dispatch_to_addr = $dispatch_to_addr;
        } else {
            $stmt = $con->prepare("SELECT * FROM `ven_address_detail` LEFT JOIN `state_code` ON `ven_address_detail`.`ven_state` = `state_code`.`state_code` WHERE `ven_address_detail`.`ven_address_id` = :shipment_id");
            $stmt->execute(array(':shipment_id' => $vendor_branch_code));
            if ($stmt->rowCount() > 0) {
                while ($data = $stmt->fetch(PDO::FETCH_ASSOC)) {
                    $dispatch_to_addr = '';
                    $dispatch_to_addr .= $data['ven_address_line_1'].'<br/>';
                    $dispatch_to_addr .= $data['ven_address_line_2'].'<br/>';
                    $dispatch_to_addr .= $data['ven_address_line_3'].'<br/>';
                    $dispatch_to_addr_statename = $data['state_name'] ." (".$data['state_code'].")"; 
                    $dispatch_to_company_gst_id = $data['ven_add_gst'];
                }
            } else {
                $dispatch_to_addr = 'N/A';
                $dispatch_to_addr_statename = 'N/A';                    
                $dispatch_to_company_gst_id = 'N/A';
            }
        }
        
        $stmt = $con->prepare("SELECT * FROM `ven_address_detail` LEFT JOIN `ven_basic_detail` ON `ven_address_detail`.`ven_id` = `ven_basic_detail`.`ven_register_id` LEFT JOIN `state_code` ON `ven_address_detail`.`ven_state` = `state_code`.`state_code` WHERE `ven_address_detail`.`ven_address_id` = :shipment_id");
        $stmt->execute(array(':shipment_id' => $vendor_branch_code));
        if ($stmt->rowCount() > 0) {
            while ($data = $stmt->fetch(PDO::FETCH_ASSOC)) {
                $dispatch_to_vendor_name = $data['ven_name'];
                $dispatch_to_addr_statename = $data['state_name'] ." (".$data['state_code'].")";; 
                $dispatch_to_company_gst_id = $data['ven_add_gst'];
            }
        } else {
            $dispatch_to_addr_statename = 'N/A';                    
            $dispatch_to_company_gst_id = 'N/A';
        }
            
    }else{
        echo "Job Wrok Not Found!!";
        exit;
    }
        
        
    $header = 
        '<table autosoize="1" style="width: 100%; border-collapse: collapse; font-family: verdana;">
            <tr>
                <td>
                    <img
                        style="margin-bottom: 10px;"
                        src="data:image/png;base64,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"
                        width="95px"
                    />
                </td>
                <td><h3>JOBWORK CHALLAN</h3></td>
            </tr>
        </table>
        <table border="1" autosoize="1" cellpadding="5" style="width: 100%; border-collapse: collapse; font-family: verdana;">
            <tr>
                <td colspan="5" rowspan="2" style="text-align: left; vertical-align: text-top; font-size: 10px; width: 50%;">
                    <strong style="font-size: 12px;">'.$billing_company.'</strong><br />
                    '.$billing_address.'<br />
                    GSTIN/UIN: '.$billing_gstid.'<br />
                    State Name : '.$billing_state_name.', Code : '.$billing_state_code.'<br />
                    CIN NO: '.$billing_cin.'
                </td>
                <td colspan="3" style="font-size: 10px; vertical-align: top; text-align: left;">
                    Challan No.<br />
                    <strong>'.$challan_id.'</strong>
                </td>
                <td colspan="3" style="font-size: 10px; vertical-align: top; text-align: left;">
                    Dated:<br />
                    <strong>'.$jw_reg_date.'</strong>
                </td>
            </tr>
            <tr>
                <td colspan="6" rowspan="3" style="vertical-align: top; font-size: 10px; text-align: left; width: 50%;">
                    <br />
                    <p><strong>Jobwork No. : </strong>'.$jw_transaction_id.'</p>
                    <p><strong>Nature of Processing : </strong>'.$nature_of_process.'</p>
                    <br />
                    <p><strong>Duration of Processing : </strong>'.$duration_of_payment.'</p>
                    <br />
                    <p><strong>Other References : </strong>'.$other_ref.'</p>
                    <br/><br/>
                    <p><strong>Vehicle No. : </strong>'.$vehicle_no.'</p>
                </td>
            </tr>
            <tr>
                <td colspan="5" style="font-size: 10px; vertical-align: text-top; text-align: left; width: 50%;">
                    Dispatch From<br />
                    <strong style="font-size: 12px;">'.$dispatch_from_company.'</strong><br />
                    '.$dispatch_from_addr.'<br/>
                    State Name : '.$dispatch_from_state_name.' ('.$dispatch_from_state_code.')'.'<br/>
                    Pincode : '.$dispatch_from_pin_code.' | GSTIN : '.$dispatch_from_company_gst_id.'
                </td>
            </tr>
            <tr>
                <td colspan="5" style="font-size: 10px; vertical-align: text-top; text-align: left; width: 50%;">
                    Jobworker / Party<br />
                    <strong style="font-size: 12px;">'.$dispatch_to_vendor_name.'</strong><br />
                    <mark>'.$dispatch_to_addr.'</mark><br/>
                    State (Code): '.$dispatch_to_addr_statename.'<br/>
                    GSTIN/UIN: '.$dispatch_to_company_gst_id.'
                </td>
            </tr>
        </table>';
    
        // BASIC DETAILS
        $results_per_page = 20;
        
        $stmt = $con->prepare("SELECT * FROM `jw_material_challan` WHERE `jw_transaction` = :transaction_id  AND `jw_challan_ref_id` = :refid");
        $stmt->execute(array(':transaction_id' => $jobwork_id, ':refid' => $material_issue_ref_id));
        
        $number_of_result = $stmt->rowCount();
        $number_of_page = ceil($number_of_result / $results_per_page);
        
        $body = "";
        $count = 0;
        $slr_no = 1;
        $sum_of_qty = 0; 
        $sum_of_amount = 0;
        while ($number_of_page > $count) {
            
            if($count+1 >= $number_of_page) {
                $page_end = '<p style="text-align:center; font-family: verdana; font-size: 10px">.: Subject to Noida Judiciary. :.</p>';
            } else {
                $page_end = '<p style="text-align:right; font-family: verdana; font-size: 10px">... to be continued on page no. '.($count+2).'</p> <pagebreak/>';
            }
            
            $my_custom_limit = $count * $results_per_page;
            $sql = $con->prepare("SELECT *, jw_material_challan.ID AS myID FROM `jw_material_challan` LEFT JOIN `components` ON `jw_material_challan`.`jw_component_id` = `components`.`component_key` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` WHERE `jw_material_challan`.`jw_transaction` = :transaction_id AND `jw_material_challan`.`jw_challan_ref_id` = :refid AND jw_material_challan.challan_status != 'C' ORDER BY jw_material_challan.ID ASC LIMIT $my_custom_limit,$results_per_page");
            $sql->execute(array(':transaction_id' => $jobwork_id, ':refid' => $material_issue_ref_id));
            $result = $sql->fetchAll();
            
            $body .= $header.'<table border="1" autosize="1" cellpadding="5" style="margin-top: 1.5px; width: 100%; border-collapse: collapse; font-family: verdana;"><tr><td style="font-size: 12px;border-bottom:1px solid #000;border-left:1px solid #000" height="39" align="left" valign="middle" bgcolor="#D8D8D8"><strong><font face="Courier New" color="#000000">SL<br />No.</font></strong></td><td style="font-size: 12px;border-bottom:1px solid #000;border-left:1px solid #000" colspan="4" align="center" valign="middle" bgcolor="#D8D8D8"><strong><font face="Courier New" color="#000000">Description Of Goods</font></strong></td><td style="font-size: 12px; border-bottom:1px solid #000;border-left:1px solid #000" align="center" valign="middle" bgcolor="#D8D8D8"><strong><font face="Courier New" color="#000000">Part</font></strong></td><td style="font-size: 12px; border-bottom:1px solid #000;border-left:1px solid #000" align="center" valign="middle" bgcolor="#D8D8D8"><strong><font face="Courier New" color="#000000">HSN/SAC</font></strong></td><td style="font-size: 12px; border-bottom:1px solid #000;border-left:1px solid #000" align="center" valign="middle" bgcolor="#D8D8D8"><strong><font face="Courier New" color="#000000">Qty</font></strong></td><td style="font-size: 12px; border-bottom:1px solid #000;border-left:1px solid #000" align="center" valign="middle" bgcolor="#D8D8D8"><strong><font face="Courier New" color="#000000">Rate</font></strong></td><td style="font-size: 12px;border-bottom:1px solid #000;border-left:1px solid #000" align="center" valign="middle" bgcolor="#D8D8D8"><strong><font face="Courier New" color="#000000">Per</font></strong></td><td style="font-size: 12px;border-bottom:1px solid #000;border-left:1px solid #000;border-right:1px solid #000" align="center" valign="middle" bgcolor="#D8D8D8"><strong><font face="Courier New" color="#000000">Amount<br />INR</font></strong></td></tr>';
            
            foreach ($result as $row) {
                $total_qty_on_each_page = $row['jw_order_qty'];
                if($row['jw_remark'] == "") {
                    $remark = '';
                } else {
                    $remark = '<br/>&nbsp;&nbsp;&nbsp;<i><span style="font-size: 8px;">remark: '.$row['jw_order_qty'].'</span></i>';
                }
                
                //HSN CODE
                if($row['jw_hsncode'] == "") {
                    $stmt = $con->prepare("SELECT `c_hsn` FROM `components` WHERE `component_key` = :key");
                    $stmt->execute(array(':key' =>$row['jw_component_id']));
                    if ($stmt->rowCount() > 0) {
                        while ($result = $stmt->fetch(PDO::FETCH_ASSOC)) {
                            $hsn_code = $result['c_hsn'];
                        }
                    } else {
                        $hsn_code = "N/A";
                    }
                } else {
                    $hsn_code = $row['jw_hsncode'];
                }
                $body .= '
                <tr>
                    <td width="5%" align="left" valign="middle" style="font-size: 10px; border-top: 0px;border-bottom: 0px;">'.$slr_no.'</td>
                    <td align="left" valign="middle" colspan="4" style="font-size: 10px; border-top: 0px;border-bottom: 0px;">'.$row['c_name'].$remark.'</td>
                    <td align="left" valign="middle" style="font-size: 10px; border-top: 0px;border-bottom: 0px;">'.$row['c_part_no'].'</td>
                    <td align="left" valign="middle" style="font-size: 10px; border-top: 0px;border-bottom: 0px;">'.$hsn_code.'</td>
                    <td align="left" valign="middle" style="font-size: 10px; border-top: 0px;border-bottom: 0px;">'.$row['jw_order_qty'].'</td>
                    <td align="right" valign="middle" style="font-size: 10px; border-top: 0px;border-bottom: 0px;">'.$row['jw_order_rate'].'</td>
                    <td align="left" valign="middle" style="font-size: 10px; border-top: 0px;border-bottom: 0px;">'.$row['units_name'].'</td>
                    <td align="right" valign="middle" style="font-size: 10px; border-top: 0px; border-bottom: 0px; border-right: 1px solid #000000;">'.number_format(str_replace(',', '', $row['jw_order_qty']) * str_replace(',', '', $row['jw_order_rate']), 2).'</td>
                </tr>';
                $slr_no = $slr_no+1;
                $sum_of_qty += $total_qty_on_each_page;
                $sum_of_amount = str_replace(',', '', ($row['jw_order_qty']*$row['jw_order_rate']) + $sum_of_amount);
            }
            if($count+1 >= $number_of_page) {
                $body .= '
                <tr>
                    <td align="left" height="60" valign="middle" style="border-top: 0px; border-bottom: 0px;"></td>
                    <td align="left" height="60" valign="middle" colspan="4"  style="border-top: 0px; border-bottom: 0px;"></td>
                    <td align="left" height="60" valign="middle" style="border-top: 0px; border-bottom: 0px;"></td>
                    <td align="left" height="60" valign="middle" style="border-top: 0px; border-bottom: 0px;"></td>
                    <td align="left" height="60" valign="middle" style="border-top: 0px; border-bottom: 0px;"></td>
                    <td align="right" height="60" valign="middle" style="border-top: 0px; border-bottom: 0px;"></td>
                    <td align="left" height="60" valign="middle" style="border-top: 0px; border-bottom: 0px;"></td>
                    <td align="left" height="60" valign="middle" style="border-right: 1px solid #000000; border-top: 0px; border-bottom: 0px;"></td>
                </tr>
                <tr>
                    <td align="left" valign="middle"></td>
                    <td style="font-size: 10px; border-top: 1px solid #000000; border-bottom: 1px solid #000000; border-left: 1px solid #000000; border-right: 1px solid #000000;" colspan="4" align="right" valign="middle">
                        <strong>GRAND TOTAL : </strong>
                    </td>
                    <td style="border-top: 1px solid #000000; border-bottom: 1px solid #000000; border-left: 1px solid #000000; border-right: 1px solid #000000;" align="left" valign="middle">
                        <strong>
                            <br />
                        </strong>
                    </td>
                    <td style="border-top: 1px solid #000000; border-bottom: 1px solid #000000; border-left: 1px solid #000000; border-right: 1px solid #000000;" align="left" valign="middle">
                        <strong>
                            <br />
                        </strong>
                    </td>
                    <td style="font-size: 10px; border-top: 1px solid #000000; border-bottom: 1px solid #000000; border-left: 1px solid #000000; border-right: 1px solid #000000;" align="left" valign="middle">
                        <strong>'.$sum_of_qty.'</strong>
                    </td>
                    <td style="border-top: 1px solid #000000; border-bottom: 1px solid #000000; border-left: 1px solid #000000; border-right: 1px solid #000000;" align="left" valign="middle">
                        <strong>
                            <br />
                        </strong>
                    </td>
                    <td style="border-top: 1px solid #000000; border-bottom: 1px solid #000000; border-left: 1px solid #000000; border-right: 1px solid #000000;" align="left" valign="middle">
                        <strong>
                            <br />
                        </strong>
                    </td>
                    <td style="font-size: 10px; border-top: 1px solid #000000; border-bottom: 1px solid #000000; border-left: 1px solid #000000; border-right: 1px solid #000000;" align="right" valign="middle">
                        <strong>'.number_format($sum_of_amount, 2).'</strong>
                    </td>
                </tr>
                <tr>
                    <td style="font-size: 10px; border-top: 1px solid #000000; border-bottom: 0px solid #000000; border-left: 1px solid #000000;" colspan="11" align="left" valign="middle">
                        <strong>Amount Chargeable (in words)<br/>INR </strong>'.amount_in_digit(str_replace(',', '', $sum_of_amount)).'
                    </td>
                </tr>
                <tr>
                    <td height="80" style="border-top:0px solid #000000; border-left: 1px solid #000000; border-right: 1px solid #000000;" colspan="11" align="left" valign="top"></td>
                </tr>
                <tr>
                    <td style="font-size: 10px; border-top: 1px solid #000000; border-left: 1px solid #000000;" colspan="5" align="left" valign="middle">
                    </td>
                    <td style="font-size: 12px; border-top: 1px solid #000000; border-left: 1px solid #000000; border-right: 1px solid #000000;" colspan="6" align="right" valign="middle">
                        <strong>for Riot Labz Private Limited</strong>
                    </td>
                </tr>
                <tr>
                    <td style="border-bottom: 1px solid #000000; border-left: 1px solid #000000; border-right: 1px solid #000000;" colspan="5" rowspan="2" height="38" align="left" valign="middle">
                        <br />
                    </td>
                    <td height="100" style="border-left: 1px solid #000000; border-right: 1px solid #000000;" colspan="6" align="left" valign="middle">
                        <br />
                    </td>
                </tr>
                <tr>
                    <td style="font-size: 12px;border-bottom: 1px solid #000000; border-left: 1px solid #000000; border-right: 1px solid #000000;" colspan="6" align="right" valign="middle">
                        <strong>Authorised Signatory</strong>
                    </td>
                </tr>
                <tr>
                    <td style="border-left: 1px solid #000000; border-right: 1px solid #000000;" colspan="11" align="left" valign="middle">
                        <br />
                    </td>
                </tr>
                <tr>
                    <td style="border-left: 1px solid #000000; border-right: 1px solid #000000;" colspan="11" align="left" valign="middle">
                        <strong>VERIFIED BY : </strong>
                    </td>
                </tr>   
            </table>
            '.$page_end;
            } else {
                $body .= '
                <tr>
                    <td align="left" height="60" valign="middle" style="border-top: 1px #000000;"></td>
                    <td align="left" height="60" valign="middle" colspan="4"  style="border-top: 1px #000000;"></td>
                    <td align="left" height="60" valign="middle" style="border-top: 1px #000000;"></td>
                    <td align="left" height="60" valign="middle" style="border-top: 1px #000000;"></td>
                    <td align="left" height="60" valign="middle" style="border-top: 1px #000000;"></td>
                    <td align="right" height="60" valign="middle" style="border-top: 1px #000000;"></td>
                    <td align="left" height="60" valign="middle" style="border-top: 1px #000000;"></td>
                    <td align="left" height="60" valign="middle" style="border-right: 1px solid #000000; border-top: 1px #000000;"></td>
                </tr>
                </table>
                '.$page_end.'<div style="page-break-before:always">&nbsp;</div> ';
            }
            $count++; 
        }
    echo $body;
    exit;
?>