
exports.pdfTemplate = function (summary, transactions, vendorName, ledgerReportSummary) {

  const date = transactions.draftData.date.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
  const date1 = moment(date[0], "DD-MM-YYYY").format("DD MMMM YYYY");
  const date2 = moment(date[1], "DD-MM-YYYY").format("DD MMMM YYYY");

  let vendorAdjusted = transactions.draftData.vendorClosingBalance;
  let riotAdjusted = parseFloat(ledgerReportSummary.closing.replace(/,/g, ''));

  let manualRiot = "";
  let manualVendor = "";

  for (let i = 0; i < summary.length; i++) {
    if (summary[i].impactOn == "ims") {
      if (summary[i].type == "debit") {
        riotAdjusted = +riotAdjusted - +summary[i].amount;

        manualRiot += `
        <td>Less</td>
        <td span="3"><br />${summary[i].description}</td>
        <td>${summary[i].amount}</td>
        `

      } else if (summary[i].type == "credit") {
        riotAdjusted = +riotAdjusted + +summary[i].amount;
        manualRiot += `
        <td>Add</td>
        <td span="3"><br />${summary[i].description}</td>
        <td>${summary[i].amount}</td>
        `
      }
    } else if (summary[i].impactOn == "vendor") {
      if (summary[i].type == "debit") {
        vendorAdjusted = +vendorAdjusted - +summary[i].amount;
        manualVendor += `
        <td>Less</td>
        <td span="3"><br />${summary[i].description}</td>
        <td>${summary[i].amount}</td>
        `
      } else if (summary[i].type == "credit") {
        vendorAdjusted = +vendorAdjusted + +summary[i].amount;
        manualVendor += `
        <td>Add</td>
        <td span="3"><br />${summary[i].description}</td>
        <td>${summary[i].amount}</td>
        `
      }
    }
  }

  let netDifference = Math.abs(vendorAdjusted) - Math.abs(riotAdjusted);


  return `<!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Document</title>
        <style>
          * {
            box-sizing: border-box;
            font-family: sans-serif;
            font-size: 14px;
            font-weight: 600;
          }
          body {
            display: flex;
            width: 100%;
            justify-content: center;
            padding: 10;
          }
          table,
          td {
            border: 2px solid black;
            border-collapse: collapse;
          }
          td {
            padding: 2px 5px;
          }
          .center-text {
            display: flex;
            border-right: none;
            border-left: none;
            border-top: none;
            justify-content: center;
          }
          .right-text {
            display: flex;
            border-right: none;
            border-left: none;
            border-top: none;
            justify-content: flex-end;
          }
        </style>
      </head>
      <body>
        <table style="width: 90vw">
          <tr>
            <td></td>
            <td span="2" class="center-text">
              <strong> Reconcillation of Books of Accounts</strong>
            </td>
            <td></td>
          </tr>
          <tr>
            <td></td>
            <td span="3" class="center-text" style="border-bottom: none">
              <strong> Financial Year 24-25 </strong>
            </td>
            <td></td>
          </tr>
          <tr>
            <td>Party Name</td>
            <td span="3">${vendorName}</td>
            <td class="center-text">Prepared By</td>
          </tr>
          <tr>
            <td class="center-text" style="border-bottom: 0">
              Date of Reconciliation
            </td>
            <td span="3">${transactions.createdOn}</td>
            <td class="center-text" style="border-bottom: 0">${transactions.createdBy}</td>
          </tr>
          <tr>
            <td>Period</td>
            <td span="3" class="center-text" style="border-bottom: 0">
            ${transactions.draftData.date}
            </td>
            <td></td>
          </tr>
          <tr>
            <td></td>
            <td span="3"></td>
            <td class="center-text" style="border-bottom: 0">Amount</td>
          </tr>
          <tr>
            <td class="right-text">Cr. Closing Bal</td>
            <td span="3" style="font-weight: 500">
              Balance as per Oakter (Riot Labz) book
            </td>
            <td>${Math.abs(parseFloat(ledgerReportSummary.closing.replace(/,/g, '')))}</td>
          </tr>
          <tr>
            <td class="right-text" style="border-bottom: none">Dr. Closing Bal</td>
            <td span="3" style="font-weight: 500">Balance as per ${vendorName}</td>
            <td>${Math.abs(transactions.draftData.vendorClosingBalance)}</td>
          </tr>
          <tr>
            <td></td>
            <td span="3" class="center-text" style="border-bottom: 0">
              Difference
            </td>
            <td></td>
          </tr>
          <tr>
            <td></td>
            <td span="3">Adjustment of the above Differences in both the books</td>
            <td></td>
          </tr>
          <tr>
            <td>Pending Enteries</td>
            <td span="3"></td>
            <td></td>
          </tr>
          <tr>
            <td class="right-text" style="border-bottom: none">Add/Less</td>
            <td span="3">Balance of Riot Labz as on ${date2}</td>
            <td>${Math.abs(parseFloat(ledgerReportSummary.closing.replace(/,/g, '')))}</td>
          </tr>
          <tr>
            ${manualRiot}
          </tr>
          <tr>
            <td></td>
            <td span="3">
              <br />
            </td>
            <td></td>
          </tr>
          <tr>
            <td></td>
            <td span="3">Balance of Riot Labz Books after entries adjustments</td>
            <td>${Math.abs(riotAdjusted)}</td>
          </tr>
          <tr>
            <td></td>
            <td span="3"><br /></td>
            <td></td>
          </tr>
          <tr>
            <td class="right-text" style="border-bottom: none">Add/Less</td>
            <td span="3">Balance of ${vendorName} as on ${date2}</td>
            <td>${Math.abs(transactions.draftData.vendorClosingBalance)}</td>
          </tr>
          <tr>
            ${manualVendor}
          </tr>
          <tr>
            <td></td>
            <td span="3">
              <br />
            </td>
            <td></td>
          </tr>
          <tr>
            <td></td>
            <td span="3">Balance of ${vendorName} after entries adjustments</td>
            <td>${Math.abs(vendorAdjusted)}</td>
          </tr>
          <tr>
            <td></td>
            <td span="3"><br /></td>
            <td></td>
          </tr>
          <tr>
            <td></td>
            <td span="3">Net Difference</td>
            <td>${netDifference}</td>
          </tr>
        </table>
      </body>
    </html>
    `
}