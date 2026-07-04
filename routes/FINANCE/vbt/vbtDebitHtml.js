
exports.vbtDebitPrint = function (header, items_data, total_part, summary_table, summary_table2, totalAmount) {
  return `
  <!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
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
        h1 {
          font-size: 1.2rem;
        }
        .container {
          width: 100%;
          min-height: 100px;
          border: 1px solid black;
        }
        .table {
          border: 1px solid black;
          width: 100%;
          border-collapse: collapse;
          border-right: none;
          border-left: none;
        }
  
        .table th,
        .table td {
          border-collapse: collapse;
          border: 1px solid black;
        }
        td,
        th {
          padding: 5px;
        }
      </style>
    </head>
    <body style="padding: 10px">
      <div class="container">
        <div style="display: flex; border-bottom: 1px solid black">
          <div style="flex: 3; border-right: 1px solid black; padding: 5px">
            Invoice To:
            <h1 style="margin-top: 5px">Riot Labz Private Limited</h1>
            HO: D57, 2nd Floor, Sector-6 <br />
          Noida, (UP)-201301 WH: A-21, Hosiery Complex, Block A Road,<br />
          Noida Phase-2, Yakubpur, Noida, (UP) - 201305 INDIA<br />
          GSTIN/UIN: 09AAHCR1005Q1Z4<br />
          State Name : Uttar Pradesh, Code : 09 <br />CIN NO:
          U29253DL2014PTC273460
          </div>
          <div style="flex: 2; display: flex; padding-left: 10px">
            <div style="flex: 1; border-right: 1px solid black; padding: 5px">
              Debit Note No.:
              <h1>${header.debitNo}</h1>
            </div>
            <div style="flex: 1; padding: 5px">
              Dated:
              <h1>${header.effective_date}</h1>
            </div>
          </div>
        </div>
  
        <div style="display: flex; border-bottom: 1px solid black">
          <div style="flex: 3; border-right: 1px solid black; padding: 5px">
            Consignee (Ship to)
            <h1 style="margin-top: 5px">${header.ven_name}</h1>
            ${header.ven_address}<br />
          GSTIN/UIN: ${header.gstin}<br />
          PAN/IT No: ${header.panNo}<br />
          State Name : Uttar Pradesh, Code : (09)<br />
          </div>
          <div style="flex: 2; display: flex; padding: 5px"></div>
        </div>
  
        <div style="display: flex">
          <div style="flex: 3; border-right: 1px solid black; padding: 5px">
            Buyer Bill
            <h1 style="margin-top: 5px">Buyer</h1>
            <p>GSTIN/UIN</p>
          </div>
          <div style="flex: 2; display: flex; padding: 5px"></div>
        </div>
  
        <div style="width: 100%">
          <table class="table" style="border-right: none">
            <tr>
              <th style="border-left: none; width: 50px">S. No</th>
              <th>Description of Goods</th>
              <th style="width: 120px">HSN/SAC</th>
              <th style="width: 80px">Part Code</th>
              <th style="width: 80px">Qty</th>
              <th>Rate</th>
              <th style="width: 70px">Unit</th>
              <th style="border-right: none">Amount</th>
            </tr>
            ${items_data}
            ${total_part}
          </table>
        </div>
        <div style="padding: 5px; display: flex; justify-content: space-between">
          <p><strong>Amount In Words :</strong>${helper.amount_to_word(totalAmount)}</p> <span> EOE</span>
        </div>
        <div style="width: 100%">
          <table class="table">
            <tr>
              <td colspan="3" style="text-align: center; border: none">
                <h1>Summary</h1>
              </td>
            </tr>
            <tr>
              <th style="width: 70%; border-left: none">A/C</th>
              <th style="text-align: center">Debit</th>
              <th style="border-right: none; text-align: center">Credit</th>
            </tr>
            ${summary_table}
            ${summary_table2}
          </table>
        </div>
  
        <div style="display: flex">
          <div
            style="
              flex: 1;
              display: flex;
              padding: 5px;
              border-right: 1px solid black;
            "
          >
            <div style="flex: 1">
              <strong>Remarks:</strong>
              <p></p>
            </div>
          </div>
          <div style="flex: 1; padding: 5px">
            <h1 style="margin-bottom: 10px">Company Bank Details</h1>
  
            <div style="display: flex; justify-content: space-between">
              <strong>Bank Name</strong>
              <p></p>
            </div>
            <div style="display: flex; justify-content: space-between">
              <strong>A/C No.</strong>
              <p></p>
            </div>
            <div style="display: flex; justify-content: space-between">
              <strong>Company's Pan</strong>
              <p></p>
            </div>
            <div style="display: flex; justify-content: space-between">
              <strong>Branch & IFSC Code</strong>
              <p></p>
            </div>
            <div style="display: flex; justify-content: space-between">
              <p></p>
              <strong>For Riot Labz Private Ltd</strong>
            </div>
          </div>
        </div>
      </div>
    </body>
  </html>
    `;
};
