const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const { sequelize, Video, initDB } = require('./db');

const app = express();
app.use(cors());
const PORT = 5000;

initDB().then(() => {
  console.log('Database initialized');
});

if (!fs.existsSync(path.join(__dirname, 'uploads'))) {
    fs.mkdirSync(path.join(__dirname, 'uploads'));
}

if (!fs.existsSync(path.join(__dirname, 'videos'))) {
    fs.mkdirSync(path.join(__dirname, 'videos'));
}
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({ storage });

app.post('/upload', upload.single('video'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).send({ error: 'No file uploaded' });
        }
        const filePath = path.join(__dirname, req.file.path);
        console.log(`File uploaded to: ${filePath}`);
        
        // Save metadata to SQLite
        await Video.create({ path: filePath, type: 'uploaded' });

        res.send({ path: filePath });
    } catch (error) {
        console.error('Error in /upload:', error);
        res.status(500).send({ error: 'Internal server error' });
    }
});

app.post('/trim', async (req, res) => {
    const { videoPath, startTime, duration } = req.body;

    if (!videoPath || !fs.existsSync(videoPath)) {
        return res.status(400).send({ error: 'Invalid video path' });
    }

    const absoluteVideoPath = path.resolve(videoPath);
    const outputPath = path.join(__dirname, `videos/trimmed_${Date.now()}.mp4`);

    console.log(`Trimming video at: ${absoluteVideoPath}`);
    console.log(`Saving trimmed video to: ${outputPath}`);

    ffmpeg(absoluteVideoPath)
        .setStartTime(startTime)
        .setDuration(duration)
        .output(outputPath)
        .on('end', async () => {
            console.log(`Trimmed video saved to: ${outputPath}`);
            
            // Save metadata to SQLite
            await Video.create({ path: outputPath, type: 'trimmed' });

            res.send({ success: true, outputPath });
        })
        .on('error', (err) => {
            console.error(`Error trimming video: ${err.message}`);
            res.status(500).send({ error: 'Error trimming video', message: err.message });
        })
        .run();
});

app.post('/merge', async (req, res) => {
    const { videoPaths } = req.body;

    if (!videoPaths || !Array.isArray(videoPaths) || videoPaths.length < 2) {
        return res.status(400).send({ error: 'Invalid video paths' });
    }

    for (const videoPath of videoPaths) {
        if (!fs.existsSync(videoPath)) {
            return res.status(400).send({ error: `Invalid video path: ${videoPath}` });
        }
    }

    const outputPath = path.join(__dirname, `videos/merged_${Date.now()}.mp4`);
    const tempDir = path.join(__dirname, 'temp');
    const listFilePath = path.join(tempDir, 'file_list.txt');

    // Ensure temp directory exists
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir);
    }

    // Create a text file with the list of input videos
    const fileList = videoPaths.map(path => `file '${path}'`).join('\n');
    fs.writeFileSync(listFilePath, fileList);

    console.log(`Merging videos: ${videoPaths.join(', ')}`);
    console.log(`Saving merged video to: ${outputPath}`);

    ffmpeg()
        .input(listFilePath)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .outputOptions('-c copy')  // This copies the codec without re-encoding
        .output(outputPath)
        .on('start', (command) => {
            console.log('FFmpeg command:', command);
        })
        .on('end', async () => {
            console.log(`Merged video saved to: ${outputPath}`);
            
            // Save metadata to SQLite
            await Video.create({ path: outputPath, type: 'merged' });

            res.send({ success: true, outputPath });

            // Clean up temp directory
            fs.unlinkSync(listFilePath);
        })
        .on('error', (err) => {
            console.error(`Error merging videos: ${err.message}`);
            res.status(500).send({ error: 'Error merging videos', message: err.message });
        })
        .run();
});

const startServer = () => {
    return app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
};

module.exports = { app, startServer };
