# Zac-the-Ripper
# Zac the Ripper

A Python GUI tool for automated DVD archival with MakeMKV integration and H.265 conversion.

## Features
- One-click DVD ripping and conversion process
- Automated MKV to H.265 MOV conversion
- Real-time file monitoring and processing
- SMPTE timecode logging for professional workflows
- High-quality output settings for archival purposes
- User-friendly GUI interface

## Technical Details
- Uses MakeMKV for initial DVD ripping
- Implements H.265/HEVC encoding via FFmpeg
- Real-time file system monitoring using watchdog
- Multithreaded processing for better performance
- Quality-focused encoding settings (CRF 18, slow preset)
- Professional-grade audio settings (AAC 256k)

## Dependencies
- Python 3.7 or higher
- MakeMKV
- FFmpeg
- tkinter
- watchdog

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/zac-the-ripper.git
cd zac-the-ripper
```

2. Create and activate a virtual environment (recommended):
```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

3. Install Python dependencies:
```bash
pip install watchdog
```

4. Install external dependencies:
   - Install [MakeMKV](https://www.makemkv.com/)
   - Install [FFmpeg](https://ffmpeg.org/download.html)
   - Ensure both are added to your system's PATH

## Usage

1. Launch the application:
```bash
python zac_the_ripper.py
```

2. Configure the following settings:
   - MKV Output Folder: Temporary storage for initial DVD rip
   - MOV Output Folder: Final destination for converted files
   - DVD Drive Index: Your DVD drive number (usually 0 or 1)

3. Click "RIP!" to start the process

## Output Specifications

- Video: H.265/HEVC (CRF 18, slow preset)
- Audio: AAC 256kbps
- Container: QuickTime MOV
- Logging: SMPTE timecode format

## System Requirements
- Windows, macOS, or Linux
- DVD drive
- Sufficient storage space for temporary MKV files and final MOV output
- 8GB RAM recommended for optimal encoding performance

## Output File Naming
Files are automatically named using the following format:
`[Original_Name]_[YYYYMMDDHHMMSS].mov`

## Logging
Process logs are automatically generated in the MOV output directory with SMPTE timecode timestamps for professional workflow integration.
