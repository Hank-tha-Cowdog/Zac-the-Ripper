import os
import subprocess
import datetime
import time
import tkinter as tk
from tkinter import filedialog, messagebox
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
import threading
import logging

def smpte_timecode_format():
    """ Converts current UTC time to SMPTE timecode formatted string. """
    return datetime.datetime.now().strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z'

class MKVHandler(FileSystemEventHandler):
    def __init__(self, output_folder, status_updater, logger):
        super().__init__()
        self.output_folder = output_folder
        self.status_updater = status_updater
        self.logger = logger

    def on_created(self, event):
        if event.is_directory:
            return
        if event.src_path.endswith('.mkv'):
            self.logger.info(f"Detected creation of {event.src_path}")
            if self.wait_until_file_is_ready(event.src_path):
                self.process_file(event.src_path)

    def wait_until_file_is_ready(self, file_path):
        """ Wait until the file can be opened, indicating it's fully written and closed. """
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
        except subprocess.CalledProcessError as e:
            self.logger.error(f"Failed to convert {file_path}. Error: {e}")

def execute_makemkv(input_drive, output_folder, logger):
    logger.info(f"Starting MakeMKV to rip DVD into {output_folder}")
    make_mkv_command = f"makemkvcon mkv disc:{input_drive} all \"{output_folder}\""
    subprocess.run(make_mkv_command, shell=True, check=True)
    logger.info("MakeMKV operation completed successfully")

class DVDConverterApp:
    def __init__(self, master):
        self.master = master
        master.title('Zac the Ripper')
        master.configure(bg='gray12')
        
        tk.Label(master, text="MKV Output Folder:", fg='white', bg='gray12').grid(row=0, column=0, padx=10, pady=10)
        self.mkv_output_var = tk.StringVar()
        tk.Entry(master, textvariable=self.mkv_output_var, width=50).grid(row=0, column=1, padx=10)
        tk.Button(master, text="Browse", command=lambda: self.browse_folder(self.mkv_output_var)).grid(row=0, column=2, padx=10)
        
        tk.Label(master, text="MOV Output Folder:", fg='white', bg='gray12').grid(row=1, column=0, padx=10, pady=10)
        self.mov_output_var = tk.StringVar()
        tk.Entry(master, textvariable=self.mov_output_var, width=50).grid(row=1, column=1, padx=10)
        tk.Button(master, text="Browse", command=lambda: self.browse_folder(self.mov_output_var)).grid(row=1, column=2, padx=10)

        tk.Label(master, text="DVD Drive Index (e.g., 0, 1, ...):", fg='white', bg='gray12').grid(row=2, column=0, padx=10, pady=10)
        self.drive_index_var = tk.StringVar()
        tk.Entry(master, textvariable=self.drive_index_var, width=50).grid(row=2, column=1, padx=10)

        rip_button = tk.Button(master, text="RIP!", command=self.run_conversion, bg='green2', fg='black')
        rip_button.grid(row=3, column=1, padx=10, pady=10, sticky=tk.W + tk.E)

        self.status_label = tk.Label(master, text="Ready", fg="white", bg='gray12')
        self.status_label.grid(row=4, columnspan=3, padx=10, pady=10)

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
        
        log_filepath = os.path.join(mov_output, "process_log.log")
        logging.basicConfig(filename=log_filepath, level=logging.INFO, format='%(asctime)s - %(message)s', datefmt=smpte_timecode_format())
        logger = logging.getLogger()
        
        threading.Thread(target=self.background_conversion, args=(drive_index, mkv_output, mov_output, logger)).start()

    def background_conversion(self, drive_index, mkv_output, mov_output, logger):
        watchdog_thread = threading.Thread(target=self.setup_watchdog, args=(mkv_output, mov_output, logger))
        watchdog_thread.start()
        execute_makemkv(drive_index, mkv_output, logger)
        watchdog_thread.join()
        self.update_status_message("Conversion process is complete.")

    def setup_watchdog(self, mkv_output, mov_output, logger):
        event_handler = MKVHandler(mov_output, self.update_status_message, logger)
        observer = Observer()
        observer.schedule(event_handler, mkv_output, recursive=False)
        observer.start()
        observer.join()

    def update_status_message(self, message):
        if self.master:
            self.master.after(100, lambda: self.status_label.config(text=message))

def main():
    root = tk.Tk()
    app = DVDConverterApp(root)
    root.mainloop()

if __name__ == "__main__":
    main()