const mongoose = require("mongoose");

let conn = null;
let Review;

const reviewSchema = new mongoose.Schema({
  index: { type: Number, unique: true },
  file1: String,
  file2: String,
  label: String,
  note: String,
  createdAt: { type: Date, default: Date.now },
  updatedAt: Date,
});

async function connect() {
  if (conn) return conn;

  conn = await mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  Review = mongoose.models.Review || mongoose.model("Review", reviewSchema);
  console.log("✅ Mongo connected (Netlify)");
  return conn;
}

exports.handler = async (event) => {
  try {
    await connect();

    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      const { index, file1, file2, label, note } = body;

      const doc = await Review.findOneAndUpdate(
        { index },
        { file1, file2, label, note, updatedAt: new Date() },
        { upsert: true, new: true }
      );

      return {
        statusCode: 200,
        body: JSON.stringify({ success: true, data: doc }),
      };
    }

    if (event.httpMethod === "GET") {
      const docs = await Review.find().sort({ index: 1 });
      return {
        statusCode: 200,
        body: JSON.stringify({ success: true, data: docs }),
      };
    }

    return { statusCode: 405, body: "Method Not Allowed" };
  } catch (err) {
    console.error("❌ Netlify function error:", err);
    return { statusCode: 500, body: err.toString() };
  }
};