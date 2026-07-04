exports.template_R12 = (sku, product, date, data) => {
    return `
    <table>
        <thead>
        <tr>
            <th colspan="8">MsCorpres Automation<br>Address line1<br>Address line2</th>
        </tr>
        </thead>
        <tbody>
        <tr>
            <td colspan="4">SKU Code: ${sku}</td>
            <td colspan="4">Line 2</td>
        </tr>
        <tr>
            <td colspan="4">SKU Name: ${product}</td>
            <td colspan="4">Report Date: ${date}</td>
        </tr>
        <tr>
            <td>Part</td>
            <td>Name</td>
            <td>Category</td>
            <td>UOM</td>
            <td>BOM Qty</td>
            <td>Required QTY</td>
            <td>Available Stock</td>
            <td>Excess QTY</td>
        </tr>
        ${data}
        </tbody>
    </table>
    `;
};