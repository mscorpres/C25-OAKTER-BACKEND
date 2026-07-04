exports.printHtml = function (header, items_data, summary_table , summary_table2) {
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
      }
      body {
        padding: 30px 5px;
        width: 100vw;
      }
      table,
      tr,
      td,
      th {
        border: 1px solid black;
        border-collapse: collapse;
      }
      .main-table {
        width: 100%;
        
      }
      .no-border{
        border: none;
      }
      td, th{
        padding: 5px 2px;
        
    }
    h5{
        white-space: nowrap;
    }
    td{
        word-wrap: break-word !important;
    }
    th{
        font-size: 0.5rem
    }
    table{

        font-size:0.8rem;
    }
    </style>
  </head>
  <body>
    <h3 style="width: 100%; text-align: center; padding-bottom: 20px">RIOT LABZ PRIVATE LIMITED (ALWAR)</h3>
    <!-- first table -->
    <table class="main-table">
      <tr style="width: 100vw">
        <td
        class="no-border"
          style="
            width: 100%;
            display: flex;
            justify-content: center;
          "
        >
          <h4 style="margin-right: 100px">
            VBT Receipt Note No.: ${header.vbt_code}
          </h5>
          <h4>Effective Date: ${header.effective_date}</h5>
        </td>
      </tr>
      <tr>
        <table class="no-border" style="width: 100%;border-left: 1px solid black; border-right: 1px solid black;">
        <tr class="no-border">
                <td class="no-border"><h5>Delivery Addr :</h5></td>
                <td class="no-border">
                  <span>
                    B-36, Matasya Industrial Area, <br />
                    Alwar-301030 ( Rajsthan) <br />
                  </span>
                </td>
                <td class="no-border"><h5>VBT Date: </h5></td>
                <td class="no-border"><span>${header.vbt_date}</span></td>
            </tr>
            <tr class="no-border">
                <td class="no-border"><h5>Vendor Name: </h5></td>
                <td class="no-border">${header.ven_name}</td>
                <td  class="no-border" ><h5>Vendor Code:</h5></td>
                <td class="no-border"><span>${header.ven_code}</span></td>
            </tr>
            <tr class="no-border">
                <td class="no-border" ><h5>GSTIN NO.:</h5></td>
                <td class="no-border" ><span>${header.gstin}</span></td>
                <td class="no-border" ><h5>Vendor Inv. No :</h5></td>
                <td class="no-border" ><span>${header.vbt_invoice_no}</span></td>
            </tr>
            <tr class="no-border">
                <td class="no-border" ><h5>Vendor Addr :</h5></td>
                <td class="no-border" ><span>${header.ven_address}</span></td>
                <td class="no-border" ><h5>MIN NO.:</h5></td>
                <td class="no-border" ><span>${header.minno}</span></td>

            </tr>
            <tr class="no-border">
                <td class="no-border"><h5> </h5></td>
                <td class="no-border"><span></span></td>
                <td class="no-border"><h5></h5></td>
                <td class="no-border"><span></span></td>
            </tr>
        </table>
      </tr>
      <tr>
        <table style="width:100%; font-size: 0.7rem;">
            <tr>
                <th>#</th>
                <th>PART CODE</th>
                <th>ITEM NAME / DESCRIPTION</th>
                <th>UOM</th>
                <th>QTY</th>
                <th>AMOUNT</th>
                <th>GST %</th>
                <th>CUST. DUTY</th>
                <th>FREIGHT</th>
                <th>OTHER CHARGE (S)</th>
                <th>TAX AMOUNT</th>
                <th>TDS</th>
                <th>TOTAL AMOUNT</th>
            </tr>
            ${items_data}
            
        </table>
      </tr>
      <tr>
        <table class="no-border" style="width: 100%;border-left: 1px solid black; border-right: 1px solid black;">
        <tr class="no-border">
            <td class="no-border"><strong>Remark (if any): </strong>${header.vbt_comment}</td>
        </tr>
        <tr ">
            <td class="no-border" style="display: flex; justify-content:center; padding-top: 50px;"><p style="margin-right: 100px">Signature</p><p></p></td>
        </tr>
        <tr>
            <td>
                <p style="margin-bottom: 10px;"><strong>REGD. OFFICE:- </strong> - B-36, Matasya Industrial Area, Alwar-301030 ( Rajsthan)</p>
                <p><strong>NOTE:-</strong></p>
            </td>
        </tr>
    </table>
      </tr>
      <tr>
        <td>
            <h4 style="border-left: 1px solid black; border-right: 1px solid black;text-align: center;">Summary</h4>
        </td>
      </tr>
      <tr>
        <table style="width: 100%;">
          <tr>
              <th style="font-size: 0.9rem">A/C</th>
              <th style="font-size: 0.9rem">Debit</th>
              <th style="font-size: 0.9rem">Credit</th>
          </tr>
          ${summary_table}
        </table>
        <table style="width: 100%;">
          ${summary_table2}
        </table>
      </tr>
    </table>
  </body>
</html>
    `;
};
