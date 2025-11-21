const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// ======== MIDDLEWARE ========
app.use(cors());
app.use(express.json());
app.use(express.static("public")); // serves index.html, images, etc.

// ======== MONGODB CONNECTION ========
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err));
  console.log('MONGODB_URI from .env:', process.env.MONGODB_URI);

// ======== SCHEMA ========
const reviewSchema = new mongoose.Schema({
  index: Number,       // 1..150
  file1: String,       // Export (Screenshot)/dune_001.jpg
  file2: String,       // Images/dune_001.jpg
  label: String,       // "yes" / "no" / ""
  note: String,        // user note
  createdAt: { type: Date, default: Date.now },
});

const Review = mongoose.model("Review", reviewSchema);

// ======== API: SAVE REVIEW FOR ONE IMAGE ========
app.post("/api/review", async (req, res) => {
  try {
    const { index, file1, file2, label, note } = req.body;

    // upsert = update if exists, otherwise create
    const doc = await Review.findOneAndUpdate(
      { index },
      { file1, file2, label, note },
      { upsert: true, new: true }
    );

    res.json({ success: true, data: doc });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// ======== API: EXPORT ALL AS CSV-LIKE JSON ========
app.get("/api/reviews", async (req, res) => {
  try {
    const docs = await Review.find().sort({ index: 1 });
    res.json({ success: true, data: docs });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});