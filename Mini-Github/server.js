require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log('MongoDB connected');
}).catch(err => {
    console.error('MongoDB connection error:', err);
});
// User schema
const userSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  password: String,
});
const User = mongoose.model('User', userSchema);

// Repository schema
const repoSchema = new mongoose.Schema({
  name: String,
  owner: String, // username
});
const Repo = mongoose.model('Repo', repoSchema);

// File schema
const fileSchema = new mongoose.Schema({
  filename: String,
  originalname: String,
  mimetype: String,
  size: Number,
  buffer: Buffer,
  uploadedBy: String,
  repo: String, // repo name
});
const File = mongoose.model('File', fileSchema);

// Multer setup for memory storage
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Register endpoint
app.post('/api/signup', async (req, res) => {
  const { username, password } = req.body;
  console.log('Signup attempt:', username);
  try {
    const hash = await bcrypt.hash(password, 10);
    const user = new User({ username, password: hash });
    await user.save();
    console.log('User created:', username);
    res.status(201).json({ message: 'User created' });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(400).json({ error: 'Username already exists' });
  }
});

// Login endpoint
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  console.log('Login attempt:', username);
  try {
    const user = await User.findOne({ username });
    if (!user) {
      console.log('User not found');
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      console.log('Password mismatch');
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    // For demo, use a simple JWT
    const token = jwt.sign({ username }, 'secret', { expiresIn: '1h' });
    console.log('Login success:', username);
    res.json({ token });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Middleware to verify JWT
function auth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'No token' });
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, 'secret');
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// Get repositories for user
app.get('/api/repos', auth, async (req, res) => {
  const repos = await Repo.find({ owner: req.user.username });
  res.json(repos.map(r => ({ name: r.name })));
});

// Create a new repository for user (unique per user)
app.post('/api/repos', auth, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Repository name required' });
  const exists = await Repo.findOne({ name, owner: req.user.username });
  if (exists) return res.status(400).json({ error: 'Repository already exists' });
  const repo = new Repo({ name, owner: req.user.username });
  await repo.save();
  res.status(201).json({ message: 'Repository created' });
});

// File upload endpoint (replace file if same name in repo)
app.post('/api/upload', auth, upload.single('file'), async (req, res) => {
  const repo = req.body.repo;
  if (!repo) return res.status(400).json({ error: 'Repository required' });
  // Remove existing file with same name in this repo for this user
  await File.findOneAndDelete({
    originalname: req.file.originalname,
    uploadedBy: req.user.username,
    repo
  });
  const file = new File({
    filename: req.file.filename,
    originalname: req.file.originalname,
    mimetype: req.file.mimetype,
    size: req.file.size,
    buffer: req.file.buffer,
    uploadedBy: req.user.username,
    repo
  });
  await file.save();
  res.json({ message: 'File uploaded' });
});

// Get files for user in a repo
app.get('/api/files', auth, async (req, res) => {
  const repo = req.query.repo;
  if (!repo) return res.status(400).json({ error: 'Repository required' });
  const files = await File.find({ uploadedBy: req.user.username, repo }).select('-buffer');
  res.json(files);
});

// Delete a repository and its files
app.delete('/api/repos/:name', auth, async (req, res) => {
  const repoName = req.params.name;
  await Repo.deleteOne({ name: repoName, owner: req.user.username });
  await File.deleteMany({ repo: repoName, uploadedBy: req.user.username });
  res.json({ message: 'Repository deleted' });
});

// Edit repository name
app.put('/api/repos/:name', auth, async (req, res) => {
  const oldName = req.params.name;
  const { newName } = req.body;
  if (!newName) return res.status(400).json({ error: 'New name required' });
  const exists = await Repo.findOne({ name: newName, owner: req.user.username });
  if (exists) return res.status(400).json({ error: 'Repository with new name already exists' });
  await Repo.updateOne({ name: oldName, owner: req.user.username }, { name: newName });
  await File.updateMany({ repo: oldName, uploadedBy: req.user.username }, { repo: newName });
  res.json({ message: 'Repository renamed' });
});

// Delete a file
app.delete('/api/files/:id', auth, async (req, res) => {
  const file = await File.findOneAndDelete({ _id: req.params.id, uploadedBy: req.user.username });
  if (!file) return res.status(404).json({ error: 'File not found' });
  res.json({ message: 'File deleted' });
});

// Download a file
app.get('/api/files/:id/download', auth, async (req, res) => {
  const file = await File.findOne({ _id: req.params.id, uploadedBy: req.user.username });
  if (!file) return res.status(404).json({ error: 'File not found' });
  res.set({
    'Content-Type': file.mimetype,
    'Content-Disposition': `attachment; filename="${file.originalname}"`
  });
  res.send(file.buffer);
});

// Update (replace) a file
app.put('/api/files/:id', auth, upload.single('file'), async (req, res) => {
  const file = await File.findOne({ _id: req.params.id, uploadedBy: req.user.username });
  if (!file) return res.status(404).json({ error: 'File not found' });
  file.filename = req.file.filename;
  file.originalname = req.file.originalname;
  file.mimetype = req.file.mimetype;
  file.size = req.file.size;
  file.buffer = req.file.buffer;
  await file.save();
  res.json({ message: 'File updated' });
});

// Serve static files from the React app build folder
app.use(express.static(path.join(__dirname, 'build')));

// Catch-all to serve index.html for React Router
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

// Use process.env.PORT for Glitch, fallback to 3000
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
