exports.printHtml = function (data, rows, row_total) {
  return `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta http-equiv="X-UA-Compatible" content="IE=edge" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Document</title>
        </head>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            font-family: sans-serif;
          }
          body {
            padding: 10px;
            display: flex;
            flex-direction: column;
            align-items: center;
          }
          table {
            width: 95%;
          }
          table,
          tr,
          td,
          th {
            border: 1px solid black;
            border-collapse: collapse;
          }
          .no-border {
            border: none;
          }
          td,
          th {
            padding: 5px 10px;
          }
          .main-table td {
            /* background-color: red; */
            /* padding: 10px 0; */
          }
        </style>
        <body>
          <h2 style="margin-bottom: 20px">MsCorpres</h2>
          <h2 style="margin-bottom: 30px">Journal Voucher</h2>
          <table>
            <tr class="no-border" style="display: flex; align-items: center; justify-content: space-between">
              <td class="no-border" style="display: flex; align-items: center">
                <h4>JV No.:</h4>
                <span>${data.jv_code}</span>
              </td>
              <td class="no-border" style="display: flex; align-items: center">
                <h4>Dated:</h4>
                <span>${data.ref_date}</span>
              </td>
            </tr>
            <tr>
              <table class="no-border main-table">
                <tr style="border-left: 1px solid black; border-right: 1px solid black;text-align:left;">
                  <th class="no-border">Particulars</th>
                  <th style="border-left: 1px solid black; border-right: 1px solid black" class="no-border">Debit</th>
                  <th class="no-border">Credit</th>
                </tr>
                ${rows}
  
                ${row_total}
      
                
      
                <!-- total -->
                
              </table>
            </tr>
            <tr class="no-border">
              <table class="no-border">
                <tr style="display: flex; justify-content: space-evenly; padding-top: 40px">
                  <td class="no-border">Prepared By</td>
                  <td class="no-border">Checked By</td>
                  <td class="no-border">Authorized By</td>
                </tr>
              </table>
            </tr>
          </table>
        </body>
      </html>
      
      `;
};
