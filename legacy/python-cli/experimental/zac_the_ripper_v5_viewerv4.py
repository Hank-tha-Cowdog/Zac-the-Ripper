import os
import subprocess
import threading
import tkinter as tk
from tkinter import filedialog, messagebox
import logging
import vlc

def smpte_timecode_format():
    """ Converts current UTC time to SMPTE timecode formatted string. """
    return datetime.datetime.now().strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z'

class FrameSampler(threading.Thread):
    def __init__(self, mkv_file_path, display_command):
        super().__init__()
        self.mkv_file_path = mkv_file_path
        self.display_command = display_command
        self.running = True

    def run(self):
        command = [
            'ffmpeg', '-re', '-i', self.mkv_file_path,
            '-f', 'image2pipe', '-vcodec', 'mjpeg', '-'
        ]
        pipe = subprocess.Popen(command, stdout=subprocess.PIPE, bufsize=10**8)
        while self.running:
            frame_data = pipe.stdout.read(1024*1024)  # Read 1MB at a time
            if frame_data:
                self.display_command(frame_data)
            else:
                break
        pipe.kill()

    def stop(self):
        self.running = False

class VLCPlayer:
    def __init__(self, master):
        self.instance = vlc.Instance()
        self.player = self.instance.media_player_new()
        self.vlc_frame = tk.Frame(master, bg="black")
        self.vlc_frame.grid(row=6, column=0, columnspan=3, sticky='nsew')
        master.grid_rowconfigure(6, weight=1)
        master.grid_columnconfigure(0, weight=1)
        
        self.canvas = tk.Canvas(self.vlc_frame, bg='black')
        self.canvas.pack(fill=tk.BOTH, expand=1)
        
        # For VLC to fill the canvas
        self.player.set_hwnd(self.canvas.winfo_id())

class DVDConverterApp:
    def __init__(self, master):
        self.master = master
        master.title('Zac the Ripper')
        master.configure(bg='gray12')
    
        self.video_player = VLCPlayer(master)

        # GUI Setup with proper grid management
        self.mkv_output_var = tk.StringVar()
        self.mkv_entry = tk.Entry(master, textvariable=self.mkv_output_var, width=50)
        self.mkv_entry.grid(row=0, column=1, padx=10)
        tk.Button(master, text="Browse MKV Output", command=lambda: self.browse_folder(self.mkv_output_var)).grid(row=0, column=2, padx=10)

        self.mov_output_var = tk.StringVar()
        self.mov_entry = tk.Entry(master, textvariable=self.mov_output_var, width=50)
        self.mov_entry.grid(row=1, column=1, padx=10)
        tk.Button(master, text="Browse MOV Output", command=lambda: self.browse_folder(self.mov_output_var)).grid(row=1, column=2, padx=10)

        tk.Label(master, text="DVD Drive Index (e.g., 0, 1, ...):", fg='white', bg='gray12').grid(row=2, column=0, padx=10, pady=10)
        self.drive_index_var = tk.StringVar()
        tk.Entry(master, textvariable=self.drive_index_var, width=50).grid(row=2, column=1, padx=10)

        self.start_btn = tk.Button(master, text="Start Ripping", command=self.initiate_ripping, bg='green2', fg='white')
        self.start_btn.grid(row=3, column=1, padx=10, pady=10, sticky=tk.W + tk.E)
        
        self.status_label = tk.Label(master, text="Ready", fg="white", bg='gray12')
        self.status_label.grid(row=4, columnspan=3, padx=10, pady=10)

    def browse_folder(self, entry_var):
        folder_selected = filedialog.askdirectory()
        if folder_selected:
            entry_var.set(folder_selected)

    def initiate_ripping(self):
        disk_index = self.drive_index_var.get()
        mkv_output = self.mkv_output_var.get()
        mov_output = self.mov_output_var.get()
        
        if not disk_index.isdigit() or not mkv_output or not mov_output:
            messagebox.showerror("Error", "Please provide valid inputs for all fields.")
            return
        
        self.status_label.config(text="Preparing to process...")
        threading.Thread(target=lambda: subprocess.run(f"makemkvcon mkv disc:{disk_index} all \"{mkv_output}\"", shell=True)).start()
        
        # Start FFmpeg sampling thread connected to VLC
        self.frame_sampler = FrameSampler(mkv_output, self.video_player.display_frame)
        self.frame_sampler.start()

def main():
    root = tk.Tk()
    app = DVDConverterApp(root)
    root.mainloop()

if __name__ == "__main__":
    main()