exports.getHeaderHtml = () => {
  return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="X-UA-Compatible" content="ie=edge">
        <style type="text/css">
            body{font-family:verdana;}
            li {list-style:none}
            table { page-break-inside:auto }
            tr    { page-break-inside:avoid; page-break-after:auto }
            thead { display:table-header-group }
            tfoot { display:tenter code hereable-footer-group }
        </style>
    </head>
    <body>
        <table>`;
};

exports.getBodyHtml = (data, img, serialNumber) => {
  try {
    // html start
    let html = `
                <td style='padding:6px; border:1px solid #000'>
                    <ul>  
                      <li><b>Vendor Code :- </b> ${data.vendor_code}</li>
                      <li><b>Vendor Name :- </b> ${data.vendor_name}</li>
                      <li><b>Part Code :- </b> ${data.part_code}</li>
                      <li><b>Part Name :- </b> ${data.part_name}</li>
                      <li><b>MIN ID :- </b> ${data.min_no}</li>
                      <li><b>MIN Date :- </b> ${data.in_date}</li>
                      <li><b>PRJ :- </b> ${data.prj_name} (${data.prj_id})</li>
                      <li><b>MIN LOC. :- </b> ${data.loc_in}</li>
                        <table>
                            <tr>
                                <td>
                                    <li><b>MIN Qty. :- </b>${data.in_qty} ${data.part_uom}</li>
                                    <br>
                                    <li><b>Box QTY. :- </b><br/><br/> ____________</li>
                                </td>
                                <td style='float:right; text-align:center'>
                                    <img height='120px' weight='120px' src='${img}'alt='QR Code' />
                                </td>
                            </tr>
                        </table>
                    </ul>
                </td>
            `;

    return html;
    // html end
  } catch (error) {
      return helper.errorResponse(res, error);
  }
};

exports.getFooterHtml = () => {
  return `
    </table>
</body>
</html>`;
};

exports.getBoxBodyHtml = (data, img) => {

  try {
    // html start
    let html = `
                <td style='padding:6px; border:1px solid #000'>
                    <ul>  
                      <li><b>Vendor Code :- </b> ${data.vendor_code}</li>
                      <li><b>Vendor Name :- </b> ${data.vendor_name}</li>
                      <li><b>Part Code :- </b> ${data.part_code}</li>
                      <li><b>Part Name :- </b> ${data.part_name}</li>
                      <li><b>MIN ID :- </b> ${data.min_no}</li>
                      <li><b>MIN Date :- </b> ${data.in_date}</li>
                      <li><b>PRJ :- </b> ${data.prj_name}</li>
                      <li><b>PRJ ID :- </b> ${data.prj_id}</li>
                        <table>
                            <tr>
                                <td>
                                    <li><b>MIN Qty. :- </b>${data.in_qty} ${data.part_uom}</li>
                                    <br>
                                    <li><b>Box NO. :- </b>${data.BOXNO}</li>
                                    <li><b>Box QTY. :- </b>${data.inBoxQty}</li>
                                </td>
                                <td style='float:right; text-align:center'>
                                    <img height='120px' weight='120px' src='${img}'alt='QR Code' />
                                </td>
                            </tr>
                        </table>
                    </ul>
                </td>
            `;

    return html;
    // html end
  } catch (error) {
    throw new Error(error.message);
  }
};

exports.getBoxLableBodyHtml = (data, img) => {
  return `
  <td style='padding:6px; border:1px solid #000'>
                    <ul>  
                      <li><b>Vendor Code :- </b> ${data["Vendor Code"]}</li>
                      <li><b>Vendor Name :- </b> ${data["Vendor Name"]}</li>
                      <li><b>Part Code :- </b> ${data["Part Code"]}</li>
                      <li><b>Part Name :- </b> ${data["Part Name"]}</li>
                      <li><b>MIN ID :- </b> ${data["MIN ID"]}</li>
                      <li><b>MIN Date :- </b> ${data["MIN Date"]}</li>
                      <li><b>Cost Center</b>: ${data["Cost Center"]}</li>
                      <li><b>PRJ ID :- </b> ${data['PRJ ID']}</li>
                        <table>
                            <tr>
                                <td>
                                    <li><b>MIN Qty. :- </b>${data["MIN Qty"]} ${data.part_uom}</li>
									<li><b>MIN Loc. :- </b>${data["MIN Loc"]} </li>
                                    <br>
                                    <li><b>Box NO. :- </b>${data["MIN ID"]}(${data.label}/${data.totalBox})</li>
                                    <li><b>Box QTY. :- </b>${data.qty}</li>
                                </td>
                                <td style='float:right; text-align:center'>
                                    <img height='120px' weight='120px' src='${img}'alt='QR Code' />
                                </td>
                            </tr>
                        </table>
                    </ul>
                </td>
  `;
}
