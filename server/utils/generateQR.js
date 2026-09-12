const QRCode = require('qrcode');
const { uploadQrPng } = require('./qrStorage');

const generateQR = async (product) => {
  const serverIP = process.env.SERVER_IP || 'localhost';
  const port = process.env.PORT || 5000;

  // URL that phone browser will open when scanned
  const qrData = `http://${serverIP}:${port}/p/${product.productId}`;

  const fileName = `${product.productId.replace(/[^a-zA-Z0-9-_]/g, '_')}.png`;

  const buffer = await QRCode.toBuffer(qrData, {
    type: 'png',
    width: 400,
    margin: 2,
    color: { dark: '#1a227f', light: '#ffffff' },
  });

  const fileId = await uploadQrPng(buffer, fileName, { productId: product.productId });

  const qrCodeUrl = `/api/qr/${fileId}`;
  return { qrCodeUrl, qrCodeData: qrData };
};

module.exports = generateQR;
