import os
import datetime
import time
import tkinter as tk
from tkinter import filedialog, messagebox, Scale
import subprocess
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
import threading
import logging
import vlc

def smpte_timecode_format():
    """ Converts current UTC time to SMPTE timecode formatted string. """
    return datetime.datetime.now().strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z'

class MKVHandler(FileSystemEventHandler):
    def __init__(self, output_folder, status_updater, logger, video_player):
        super().__init__()
        self.output_folder = output_folder
        self.status_updater = status_updater
        self.logger = logger
        self.video_player = video_player

    def on_created(self, event):
        if event.is_directory:
            return
        if event.src_path.endswith('.mkv'):
            self.logger.info(f"Detected creation of {event.src_path}")
            if self.wait_until_file_is_ready(event.src_path):
                self.process_file(event.src_path)

    def wait_until_file_is_ready(self, file_path):
        while True:
            try:
                with open(file_path, 'rb') as f:
                    pass
                self.logger.info(f"File {file_path} is ready for processing.")
                return True
            except IOError:
                self.logger.info(f"Waiting for file {file_path} to be ready...")
                time.sleep(10)

    def process_file(self, file_path):
        file_name = os.path.basename(file_path)
        timestamp = datetime.datetime.now().strftime("%Y%m%d%H%M%S")
        output_file_name = f"{os.path.splitext(file_name)[0]}_{timestamp}.mov"
        output_path = os.path.join(self.output_folder, output_file_name)
        ffmpeg_command = f'ffmpeg -i "{file_path}" -c:v prores -profile:v 3 "{output_path}"'
        try:
            subprocess.run(ffmpeg_command, shell=True, check=True)
            self.logger.info(f"Successfully converted {file_path} to {output_path}")
            if self.video_player and isinstance(self.video_player, VLCPlayer):
                self.video_player.play_video(output_path)
        except subprocess.CalledProcessError as e:
            self.logger.error(f"Failed to convert {file_path}. Error: {e}")

def execute_makemkv(input_drive, output_folder, logger):
    logger.info(f"Starting MakeMKV to rip DVD into {output_folder}")
    make_mkv_command = f"makemkvcon mkv disc:{input_drive} all \"{output_folder}\""
    subprocess.run(make_mkv_command, shell=True, check=True)
    logger.info("MakeMKV operation completed successfully")

class VLCPlayer:
    def __init__(self, master):
        self.vlc_instance = vlc.Instance()
        self.media_player = self.vlc_instance.media_player_new()

        self.frame = tk.Frame(master, bg='black')
        self.frame.pack(side=tk.BOTTOM, fill=tk.BOTH, expand=1)
        self.canvas = tk.Canvas(self.frame, bg='black')
        self.canvas.pack(fill=tk.BOTH, expand=1)

        self.scale = Scale(master, from_=50, to=200, orient=tk.HORIZONTAL, label="Scale Video")
        self.scale.set(100)
        self.scale.pack(side=tk.BOTTOM, fill=tk.X)
        self.scale.bind("<Motion>", self.scale_video)

    def play_video(self, video_path):
        media = self.vlc_instance.media_new(video_path)
        self.media_player.set_media(media)
        self.media_player.set_xwindow(self.canvas.winfo_id())
        self.media_player.play()

    def scale_video(self, event):
        scale_ratio = self.scale.get() / 100.0
        width = int(self.canvas.winfo_width() * scale_ratio)
        height = int(self.canvas.winfo_height() * scale_ratio)
        self.media_player.video_set_scale(0)  # Disable auto scale
        self.media_player.video_set_size(width, height)

class DVDConverterApp:
    def __init__(self, master):
        self.master = master
        master.title('Zac the Ripper')
        master.configure(bg='gray12')
        
        tk.Label(master, text="MKV Output Folder:", fg='white', bg='gray12').grid(row=0, column=0, padx=10, pady=10)
        self.mkv_output_var = tk.StringVar()
        mkv_entry = tk.Entry(master, textvariable=self.mkv_output_var, width=50)
        mkv_entry.grid(row=0, column=1, padx=10)
        tk.Button(master, text="Browse", command=lambda: self.browse_folder(self.mkv_output_var)).grid(row=0, column=2, padx=10)
        
        tk.Label(master, text="MOV Output Folder:", fg='white', bg='gray12').grid(row=1, column=0, padx=10, pady=10)
        self.mov_output_var = tk.StringVar()
        mov_entry = tk.Entry(master, textvariable=self.mov_output_var, width=50)
        mov_entry.grid(row=1, column=1, padx=10)
        tk.Button(master, text="Browse", command=lambda: self.browse_folder(self.mov_output_var)).grid(row=1, column=2, padx=10)

        tk.Label(master, text="DVD Drive Index (e.g., 0, 1, ...):", fg='white', bg='gray12').grid(row=2, column=0, padx=10, pady=10)
        self.drive_index_var = tk.StringVar()
        drive_entry = tk.Entry(master, textvariable=self.drive_index_var, width=50)
        drive_entry.grid(row=2, column=1, padx=10)

        rip_button = tk.Button(master, text="RIP!", command=self.run_conversion, bg='green2', fg='black')
        rip_button.grid(row=3, column=1, padx=10, pady=10, sticky=tk.W + tk.E)
        
        self.status_label = tk.Label(master, text="Ready", fg="white", bg='gray12')
        self.status_label.grid(row=4, columnspan=3, padx=10, pady=10)

        self.logger = self.setup_logger(mov_entry.get())
        self.video_player = VLCPlayer(master)

    def browse_folder(self, entry_var):
        folder_selected = filedialog.askdirectory()
        if folder_selected:
            entry_var.set(folder_selected)

    def run_conversion(self):
        mkv_output = self.mkv_output_var.get()
        mov_output = self.mov_output_var.get()
        drive_index = self.drive_index_var.get()
        if not (mkv_output and mov_output and drive_index):
            messagebox.showerror("Error", "Please fill all fields.")
            return
        self.status_label.config(text="Preparing to process...")
        threading.Thread(target=self.background_conversion, args=(drive_index, mkv_output, mov_output)).start()

    def background_conversion(self, drive_index, mkv_output, mov_output):
        self.setup_watchdog(mkv_output, mov_output)
        execute_makemkv(drive_index, mkv_output, self.logger)
        self.update_status_message("Conversion process is complete.")

    def setup_watchdog(self, mkv_output, mov_output):
        event_handler = MKVHandler(mov_output, self.update_status_message, self.logger, self.video_player)
        observer = Observer()
        observer.schedule(event_handler, mkv_output, recursive=False)
        observer.start()
        try:
            while True:
                time.sleep(1)
        finally:
            observer.stop()
            observer.join()

    def update_status_message(self, message):
        if self.master:
            self.master.after(100, lambda: self.status_label.config(text=message))

    def setup_logger(self, log_path):
        logging.basicConfig(filename=log_path, level=logging.INFO, format='%(asctime)s - %(message)s', datefmt=smpte_timecode_format())
        return logging.getLogger()

def main():
    root = tk.Tk()
    app = DVDConverterApp(root)
    root.mainloop()

if __name__ == "__main__":
    main()