exports.GPPrintHtml = (data, parts) => {
	return `
    <html lang="en">
        <head>
            <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
            <meta http-equiv="X-UA-Compatible" content="IE=edge" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <title>Document</title>
            <style>
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
                font-family: sans-serif;
                font-size: 0.9rem;
            }
            body {
                display: flex;
                flex-direction: column;        
            }
            .heading {
                text-align: center;
                margin: 20px 0;
            }
            section {
                width: 100%;
            }
            table,
            tr,
            td {
                border-collapse: collapse;
                border: 1px solid black;
            }
            .section-1 table {
                width: 100%;
            }
            table.main-table th {
                border: 1px solid black;
                border-top: none;
            }
            th,
            td {
                padding-left: 2px;
                word-break: break-word;
            }

            .no-border td,
            tr {
                border: none;
            }
            .no-bottom-border td {
                border: none;
                border-collapse: collapse;
                border-left: 1px solid black;
                border-right: 1px solid black;
            }
            </style>
        </head>
        <body>
            <h2 class="heading">DELIVERY CHALLAN</h2>
            <section class="section-1">
                <table style="border: none; table-layout: fixed">
                    <tbody>
                        <tr>
                            <td width="50%" rowspan="4">
                            <h3>${data.bill_from_company}</h3>
                            <p>
                                ${data.bill_from_address}<br/>
                                GSTIN/UIN: ${data.bill_from_gstin}<br/>
                                State Name : ${data.bill_from_statename}, Code : ${data.bill_from_statecode}<br/>
                                CIN: ${data.bill_from_cin}
                            </p>
                            </td>
                        </tr>
                        <tr>
                            <td>
                            <p>Delivery Note No.</p>
                            <h3> ${data.transaction_id}</h3>
                            </td>
                            <td>
                            <p>Dated</p>
                            <h3> ${data.transaction_dt}</h3>
                            </td>
                        </tr>
                        <tr>
                            <td></td>
                            <td>
                            <p>Mode/Terms of Payment</p>
                            <p>${data.terms_of_payment}</p>
                            </td>
                        </tr>
                        <tr>
                            <td>
                            <p>Reference No. &amp; Date.</p>
                            <p> ${data.reference_no_dt}</p>
                            </td>
                            <td>
                            <p>Other References</p>
                            <p>${data.other_references}</p>
                            </td>
                        </tr>
                        <tr>
                            <td rowspan="4">
                            <p>Consignee (Ship to)</p>
                            <h3> ${data.ship_to_vendor}<br/></h3>
                            <p>
                                ${data.ship_to_address}
                            </p>
                            <table style="border: none" class="no-border">
                                <tbody>
                                <tr>
                                    <td>GSTIN/UIN</td>
                                    <td>: ${data.ship_to_gstin}</td>
                                </tr>
                                <tr>
                                    <td>PAN/IT No</td>
                                    <td>: ${data.ship_to_panno}</td>
                                </tr>
                                <tr style="border: none">
                                    <td>State Name</td>
                                    <td>${data.ship_to_statename}</td>
                                </tr>
                                </tbody>
                            </table>
                            </td>
                        </tr>
                        <tr rowspan="1">
                            <td>
                            <p style='flex-wrap: wrap'>Buyer's Order No.</p>
                            ${data.buyer_order_no}
                            <br />
                            <br  />
                            <br />
                            </td>
                            <td>
                            <p>Dated</p>
                            --
                            <br />
                            </td>
                        </tr>
                        <tr>
                            <td>
                            <p>Dispatch Doc No.</p>
                            ${data.dispatch_doc_no}
                            <br />
                            </td>
                            <td>
                            Destination<br />
                            ${data.destination}
                            </td>
                        </tr>
                        <tr>
                            <td>
                            <p>Dispatched through</p>
                            ${data.dispatch_through}
                            </td>
                            <td>
                            <p>Vehicle No.</p>
                            ${data.vehicle_no}
                            </td>
                        </tr>

                        <tr>
                            <td rowspan="4">
                            <p>Buyer (Bill to)</p>
                            <h3> ${data.bill_to_vendor}</h3>
                            <p>
                            ${data.bill_to_address}
                            </p>
                            <table style="border: none" class="no-border">
                                <tbody>
                                <tr>
                                    <td>GSTIN/UIN</td>
                                    <td>: ${data.bill_to_gstin}</td>
                                </tr>
                                <tr>
                                    <td>PAN/IT No</td>
                                    <td>:  ${data.bill_to_panno}</td>
                                </tr>
                                <tr>
                                    <td>State Name</td>
                                    <td>${data.bill_to_statename}</td>
                                </tr>
                                </tbody>
                            </table>
                            </td>
                            <td rowspan="4" colspan="2">
                            <p>Terms of Delivery</p>
                            ${data.terms_of_delivery}
                            <br />
                            <br />
                            <br />
                            <br />
                            <br />
                            </td>
                        </tr>
                    </tbody>
                </table>
                <table style="border: none" class="main-table">
                    <tbody>
                        <tr>
                            <th>SI No.</th>
                            <th>Description of Goods</th>
                            <th>HSN/SAC</th>
                            <th>Part No.</th>
                            <th>Quantity</th>
                            <th>Rate</th>
                            <th>per</th>
                            <th>Amount</th>
                        </tr>
                        ${parts}
                        <tr>
                            <td st=""></td>
                            <td
                            style="
                                display: flex;
                                border: none;
                                border-top: 1px solid black;
                                justify-content: flex-end;
                                padding: 0 10px;
                            "
                            >
                            Total
                            </td>
                            <td></td>
                            <td></td>
                            <td></td>
                            <td></td>
                            <td></td>
                            <td>₹ ${data.sum_total_amt}</td>
                        </tr>
                        <tr>
                            <td colspan="8">
                            <p style="display: flex; justify-content: space-between">
                                <span>Amount Chargeable (in words)</span>
                                <span style="text-align: end">E. &amp; O.E</span>
                            </p>
                            <br />
                            <h3>INR ${data.sum_total_amt_in_word}</h3>
                            </td>
                        </tr>
                        
                        <tr
                            style="border-left: 1px solid black; border-right: 1px solid black"
                            class="no-border"
                        >
                            <td colspan="8"><br />
                            Tax Amount (in words) : <strong>NIL</strong><br /><br />
                            <strong>Remarks :</strong><br />
                            ${data.narration}<br /><br />
                            </td>
                        </tr>
                    </tbody>
                </table>
                <table
                    class="no-border"
                    style="
                    border-bottom: none;
                    border-top: none;
                    border-left: 1px solid black;
                    border-right: 1px solid black;
                    "
                >
                    <tbody>
                        <tr>
                            <td>Company's PAN</td>
                            <td><strong>:${data.bill_from_pan}</strong></td>
                        </tr>
                    </tbody>
                </table>

                <table style="border-top: none">
                    <tbody>
                        <tr>
                            <td>
                            <p>Recd. in Good Condition</p>
                            <br />
                            <br />
                            <br />
                            <br />
                            </td>
                            <td
                            style="
                                display: flex;
                                flex-direction: column;
                                align-items: flex-end;
                                border: none;
                                border-top: 1px solid black;
                                justify-content: space-between;
                            "
                            >
                            <strong>for Riot Labz Private Limited</strong>
                            <br />
                            <br />
                            <br />
                            <p>Authorised Signatory</p>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </section>
        </body>
    </html>
    `;
};
