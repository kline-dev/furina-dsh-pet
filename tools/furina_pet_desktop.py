#!/usr/bin/env python3
"""Furina desktop pet for DeepSeek Harness.

A frameless, always-on-top, transparent desktop window showing the official
petdex furina-2 sprite. It reads live agent mood + task progress from the
DSH web server routes served by the furina desktop pet plugin:

  GET /dsh-pet-assets/furina/sprite.webp   (the official spritesheet)
  GET /dsh-pet-assets/furina/status.json   (live mood/progress/todos)

Controls:
  left-drag   move the pet (plays directional running while dragging)
  left-click  wave
  right-click menu: size / opacity / task panel / hide / quit
"""

import io
import json
import os
import sys
import threading
import time
import urllib.request

import tkinter as tk
import tkinter.font as tkfont
import tkinter.ttk as ttk
import numpy as np
from PIL import Image, ImageDraw, ImageTk

BASE_URL = os.environ.get('FURINA_PET_BASE', 'http://127.0.0.1:3080')
STATUS_URL = BASE_URL + '/dsh-pet-assets/furina/status.json'
SPRITE_URL = BASE_URL + '/dsh-pet-assets/furina/sprite.webp'

HERE = os.path.dirname(os.path.abspath(__file__))
WORKSPACE = os.path.dirname(HERE) if os.path.basename(HERE).lower() == 'tools' else HERE
SETTINGS_PATH = os.path.join(WORKSPACE, 'pet-assets', 'desktop-settings.json')

FRAME_W, FRAME_H = 192, 208
BUBBLE_H = 30
MAGIC = '#010203'

# Official petdex furina-2 state table: (row, frames, durationMs)
STATES = {
    'idle': (0, 6, 1100),
    'running-right': (1, 8, 1060),
    'running-left': (2, 8, 1060),
    'waving': (3, 4, 700),
    'jumping': (4, 5, 840),
    'failed': (5, 8, 1220),
    'waiting': (6, 6, 1010),
    'running': (7, 6, 820),
    'review': (8, 6, 1030),
}

FONT = 'Microsoft YaHei UI'
MARKS = {'completed': ('\u2713', '#7ce38b'), 'in_progress': ('\u25b6', '#7cc7ff'),
         'pending': ('\u25cb', '#9aa0a6')}


def load_settings():
    defaults = {'scale': 0.8, 'opacity': 0.95, 'panel': True, 'hidden': False,
                'x': None, 'y': None}
    try:
        with open(SETTINGS_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
        if isinstance(data, dict):
            for key in defaults:
                if key in data:
                    defaults[key] = data[key]
        defaults['scale'] = min(2.0, max(0.5, float(defaults['scale'])))
        defaults['opacity'] = min(1.0, max(0.0, float(defaults['opacity'])))
    except Exception:
        pass
    return defaults


def save_settings(settings):
    try:
        os.makedirs(os.path.dirname(SETTINGS_PATH), exist_ok=True)
        with open(SETTINGS_PATH, 'w', encoding='utf-8') as f:
            json.dump(settings, f, ensure_ascii=False)
    except Exception:
        pass


class FurinaPet:
    def __init__(self):
        self.settings = load_settings()
        self.status = {'mood': 'idle', 'detail': '', 'progress': None,
                       'todos': None, 'ts': 0}
        self.stop = False
        self.sheet = self.load_sheet()

        self.root = tk.Tk()
        self.root.withdraw()
        self.root.overrideredirect(True)
        self.root.attributes('-topmost', True)
        self.root.configure(bg=MAGIC)
        try:
            self.root.attributes('-transparentcolor', MAGIC)
        except tk.TclError:
            pass
        self.apply_opacity()

        self.scale = float(self.settings['scale'])
        self.sprite_w = int(FRAME_W * self.scale)
        self.sprite_h = int(FRAME_H * self.scale)
        self.canvas = tk.Canvas(self.root, width=self.sprite_w,
                                height=self.sprite_h + BUBBLE_H, bg=MAGIC,
                                highlightthickness=0)
        self.canvas.pack()

        self.images = {}
        self.current_frame_key = None
        self.state = 'idle'
        self.state_start = time.time()
        self.wave_until = 0.0
        self.celebrate_until = 0.0
        self.bubble = ''
        self.bubble_photo = None
        self.panel_sig = None
        self.panel_pos = None
        self._save_pending = None
        self.settings_win = None

        # drag
        self.drag = None  # dict(sx, sy, wx, wy, moved, dir)

        # window placement
        if self.settings['x'] is None or self.settings['y'] is None:
            sw, sh = self.root.winfo_screenwidth(), self.root.winfo_screenheight()
            self.x = sw - self.sprite_w - 16
            self.y = sh - self.sprite_h - BUBBLE_H - 16
        else:
            self.x, self.y = int(self.settings['x']), int(self.settings['y'])
        self.home = (self.x, self.y)

        self.panel_win = None
        self.panel_items = {}
        self.restore_win = None

        self.build_menu()
        self.canvas.bind('<Button-1>', self.on_press)
        self.canvas.bind('<B1-Motion>', self.on_drag_move)
        self.canvas.bind('<ButtonRelease-1>', self.on_release)
        self.canvas.bind('<Button-3>', self.on_right_click)

        threading.Thread(target=self.status_reader, daemon=True).start()

        self.place(self.x, self.y)
        if self.settings['hidden']:
            self.hide_pet(initial=True)
        else:
            self.root.deiconify()
        self.tick()

    # ---------- network ----------
    def fetch(self, url, binary=False):
        with urllib.request.urlopen(url, timeout=2.5) as r:
            data = r.read()
        return data if binary else data.decode('utf-8', 'replace')

    def load_sheet(self):
        local = os.path.join(WORKSPACE, 'pet-assets', 'sprite-clean.png')
        for attempt in range(24):
            try:
                data = self.fetch(SPRITE_URL, binary=True)
                return Image.open(io.BytesIO(data)).convert('RGBA')
            except Exception:
                pass
            if os.path.exists(local):
                try:
                    return Image.open(local).convert('RGBA')
                except Exception:
                    pass
            time.sleep(1)
        sys.exit('cannot load sprite')

    def status_reader(self):
        while not self.stop:
            try:
                data = json.loads(self.fetch(STATUS_URL))
                if isinstance(data, dict):
                    self.status = data
            except Exception:
                pass
            time.sleep(0.4)

    # ---------- rendering ----------
    def frame_image(self, row, idx, scale):
        key = (row, idx, scale)
        img = self.images.get(key)
        if img is None:
            crop = self.sheet.crop((idx * FRAME_W, row * FRAME_H,
                                    (idx + 1) * FRAME_W, (row + 1) * FRAME_H))
            w, h = max(1, int(FRAME_W * scale)), max(1, int(FRAME_H * scale))
            if scale != 1.0:
                crop = crop.resize((w, h), Image.LANCZOS)
            crop = self.clean_alpha(crop)
            img = ImageTk.PhotoImage(crop)
            self.images[key] = img
        return img

    @staticmethod
    def clean_alpha(image):
        """Kill the resampling halo: unpremultiply semi pixels, then
        hard-binarize alpha so scaled edges stay crisp at every size."""
        a = np.array(image)
        alpha = a[..., 3].astype(np.int32)
        semi = (alpha > 0) & (alpha < 255)
        if semi.any():
            rgb = a[..., :3].astype(np.float32)
            fixed = np.clip(rgb * 255.0 / np.maximum(alpha, 1)[..., None],
                            0, 255).astype(np.uint8)
            a[semi, :3] = fixed[semi]
        a[alpha < 128, 3] = 0
        a[alpha >= 128, 3] = 255
        return Image.fromarray(a)

    def set_sprite(self, state, idx, scale):
        key = (state, idx, scale)
        if key == self.current_frame_key:
            return
        self.current_frame_key = key
        img = self.frame_image(STATES[state][0], idx, scale)
        self.canvas.delete('sprite')
        self.canvas.create_image(0, BUBBLE_H, image=img, anchor='nw',
                                 tags='sprite')

    def set_bubble(self, text):
        if text == self.bubble:
            return
        self.bubble = text
        self.canvas.delete('bubble')
        if not text:
            return
        font = tkfont.Font(family=FONT, size=9)
        tw = font.measure(text)
        th = font.metrics('linespace')
        pad_x, pad_y = 12, 5
        w = max(40, tw + pad_x * 2)
        h = th + pad_y * 2
        img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)
        draw.rounded_rectangle((0, 0, w - 1, h - 1), radius=h // 2,
                               fill=(24, 26, 36, 230),
                               outline=(255, 255, 255, 26), width=1)
        self.bubble_photo = ImageTk.PhotoImage(img)
        x = max(0, (self.sprite_w - w) // 2)
        y = max(0, (BUBBLE_H - h) // 2)
        self.canvas.create_image(x, y, image=self.bubble_photo, anchor='nw',
                                 tags='bubble')
        self.canvas.create_text(x + w // 2, y + h // 2 - 1, text=text,
                                fill='#ffffff', font=font, tags='bubble')

    def apply_opacity(self):
        try:
            self.root.attributes('-alpha', float(self.settings['opacity']))
        except tk.TclError:
            pass

    def apply_scale(self, value):
        value = min(2.0, max(0.5, float(value)))
        self.settings['scale'] = value
        self.scale = value
        self.sprite_w = int(FRAME_W * value)
        self.sprite_h = int(FRAME_H * value)
        self.canvas.config(width=self.sprite_w, height=self.sprite_h + BUBBLE_H)
        self.current_frame_key = None
        self.images.clear()
        self.place(self.x, self.y)
        self.schedule_save()

    def place(self, x, y):
        sw, sh = self.root.winfo_screenwidth(), self.root.winfo_screenheight()
        x = min(max(-self.sprite_w + 40, x), sw - 40)
        y = min(max(0, y), sh - self.sprite_h - BUBBLE_H)
        self.x, self.y = x, y
        self.root.geometry(f'+{x}+{y}')

    # ---------- state ----------
    def pick_state(self):
        now = time.time()
        if self.drag is not None and self.drag.get('moved'):
            return 'running-left' if self.drag['dir'] == 'left' else 'running-right'
        if now < self.wave_until:
            return 'waving'
        mood = self.status.get('mood', 'idle')
        if mood == 'failed':
            return 'failed'
        if mood == 'waiting':
            return 'waiting'
        if mood == 'review':
            return 'review'
        if mood == 'running':
            return 'running'
        if now < self.celebrate_until or mood == 'jumping':
            return 'jumping'
        if mood == 'waving':
            return 'waving'
        return 'idle'

    def pick_bubble(self, state, now):
        progress = self.status.get('progress') or {}
        detail = self.status.get('detail', '')
        if self.status.get('ts', 0) and now - float(self.status.get('ts', 0)) / 1000 > 8:
            return '\u8fde\u63a5\u4e2d\u65ad\u2026'
        if state == 'failed':
            return ('\u51fa\u9519\u4e86 \u00b7 ' + detail) if detail else '\u51fa\u9519\u4e86\u2026'
        if state == 'waiting':
            return '\u7b49\u5f85\u8bb8\u53ef\u2026'
        if state == 'review':
            return '\u601d\u8003\u4e2d\u2026'
        if state == 'running':
            if progress.get('hasTodos') and progress.get('currentTask'):
                return f"\u5de5\u4f5c\u4e2d {progress.get('percent', 0)}% \u00b7 {progress['currentTask']}"
            return ('\u5de5\u4f5c\u4e2d \u00b7 ' + detail) if detail else '\u5de5\u4f5c\u4e2d\u2026'
        if state == 'jumping':
            return '\u5b8c\u6210\u5566\uff01'
        if state == 'waving':
            return '\u4f60\u597d\u5440\uff01'
        return ''

    # ---------- panel ----------
    def panel_visible(self):
        progress = self.status.get('progress') or {}
        return bool(self.settings['panel'] and progress.get('hasTodos')
                    and progress.get('total', 0) > 0)

    def refresh_panel(self):
        visible = self.panel_visible()
        if not visible:
            if self.panel_win is not None:
                self.panel_win.withdraw()
            self.panel_sig = None
            return
        if self.panel_win is None:
            win = tk.Toplevel(self.root)
            win.withdraw()
            win.overrideredirect(True)
            win.attributes('-topmost', True)
            win.configure(bg=MAGIC)
            try:
                win.attributes('-transparentcolor', MAGIC)
                win.attributes('-alpha', float(self.settings['opacity']))
            except tk.TclError:
                pass
            body = tk.Frame(win, bg='#181a24')
            body.pack(padx=1, pady=1)
            head = tk.Frame(body, bg='#181a24')
            head.pack(fill='x', padx=12, pady=(10, 2))
            self.panel_items['title'] = tk.Label(
                head, text='\u4efb\u52a1\u8fdb\u5ea6', bg='#181a24', fg='#ffffff',
                font=(FONT, 10, 'bold'))
            self.panel_items['title'].pack(side='left')
            self.panel_items['count'] = tk.Label(
                head, text='', bg='#181a24', fg='#9aa0a6', font=(FONT, 9))
            self.panel_items['count'].pack(side='left', padx=8)
            self.panel_items['percent'] = tk.Label(
                head, text='', bg='#181a24', fg='#7cc7ff',
                font=(FONT, 10, 'bold'))
            self.panel_items['percent'].pack(side='right')
            bar = tk.Canvas(body, width=256, height=8, bg='#2b2f3d',
                            highlightthickness=0)
            bar.pack(fill='x', padx=12, pady=(4, 6))
            self.panel_items['bar'] = bar
            self.panel_items['current'] = tk.Label(
                body, text='', bg='#181a24', fg='#d8dbe2', font=(FONT, 9),
                anchor='w', justify='left', wraplength=256)
            self.panel_items['current'].pack(fill='x', padx=12)
            self.panel_items['list'] = tk.Frame(body, bg='#181a24')
            self.panel_items['list'].pack(fill='x', padx=12, pady=(2, 10))
            self.panel_win = win
        elif not self.panel_win.winfo_viewable():
            self.panel_win.deiconify()

        progress = self.status.get('progress') or {}
        todos = self.status.get('todos') or []
        sig = (progress.get('percent'), progress.get('completed'),
               progress.get('total'), progress.get('currentTask'),
               tuple((t.get('content'), t.get('status')) for t in todos[:20]))
        if sig == self.panel_sig:
            self.position_panel()
            return
        self.panel_sig = sig

        self.panel_items['count'].config(
            text=f"{progress.get('completed', 0)}/{progress.get('total', 0)}")
        self.panel_items['percent'].config(text=f"{progress.get('percent', 0)}%")
        bar = self.panel_items['bar']
        bar.delete('all')
        pct = max(0, min(100, int(progress.get('percent', 0))))
        bar.create_rectangle(0, 0, 256 * pct / 100, 8, fill='#5b9bff', outline='')
        current = progress.get('currentTask')
        self.panel_items['current'].config(
            text=('\u5f53\u524d \u00b7 ' + current) if current else '')
        for child in self.panel_items['list'].winfo_children():
            child.destroy()
        for item in todos[:20]:
            mark, color = MARKS.get(item.get('status'), ('\u25cb', '#9aa0a6'))
            row = tk.Frame(self.panel_items['list'], bg='#181a24')
            row.pack(fill='x', pady=1)
            tk.Label(row, text=mark, bg='#181a24', fg=color,
                     font=(FONT, 9)).pack(side='left')
            content = item.get('content', '')
            if item.get('status') == 'completed':
                fg = '#7a7f88'
                font = (FONT, 9, 'overstrike')
            else:
                fg = '#d8dbe2'
                font = (FONT, 9)
            tk.Label(row, text=content, bg='#181a24', fg=fg, font=font,
                     anchor='w', justify='left', wraplength=224).pack(
                         side='left', fill='x', expand=True)

        self.panel_win.update_idletasks()
        self.panel_pos = None
        self.position_panel()

    def position_panel(self):
        if self.panel_win is None or not self.panel_win.winfo_viewable():
            return
        if (self.x, self.y) == self.panel_pos:
            return
        self.panel_pos = (self.x, self.y)
        pw = self.panel_win.winfo_reqwidth()
        ph = self.panel_win.winfo_reqheight()
        px = self.x + self.sprite_w - pw - 6
        py = self.y - ph - 8
        if py < 0:
            py = self.y + self.sprite_h + BUBBLE_H + 8
        self.panel_win.geometry(f'+{max(0, px)}+{max(0, py)}')

    # ---------- menu ----------
    def build_menu(self):
        menu = tk.Menu(self.root, tearoff=0)
        panel_var = tk.BooleanVar(value=bool(self.settings['panel']))
        menu.add_command(label='\u5927\u5c0f / \u900f\u660e\u5ea6\u8bbe\u7f6e\u2026',
                         command=self.open_settings)
        menu.add_checkbutton(label='\u4efb\u52a1\u9762\u677f', variable=panel_var,
                             command=lambda: self.set_panel(panel_var.get()))
        menu.add_command(label='\u56de\u5230\u53f3\u4e0b\u89d2',
                         command=self.back_home)
        menu.add_command(label='\u9690\u85cf\u5ba0\u7269', command=self.hide_pet)
        menu.add_separator()
        menu.add_command(label='\u9000\u51fa', command=self.quit_app)
        self.menu = menu

    def schedule_save(self):
        if self._save_pending is not None:
            try:
                self.root.after_cancel(self._save_pending)
            except Exception:
                pass
        def do_save():
            self._save_pending = None
            save_settings(self.settings)
        self._save_pending = self.root.after(700, do_save)

    def on_size_slider(self, value, label):
        pct = int(round(float(value)))
        label.config(text=f'{pct}%')
        self.apply_scale(pct / 100.0)

    def on_opacity_slider(self, value, label):
        pct = int(round(float(value)))
        label.config(text=f'{pct}%')
        self.set_opacity(pct / 100.0)

    def open_settings(self):
        if self.settings_win is not None and self.settings_win.winfo_exists():
            self.settings_win.deiconify()
            self.settings_win.lift()
            return
        win = tk.Toplevel(self.root)
        win.title('\u8299\u5b81\u5a1c\u8bbe\u7f6e')
        win.attributes('-topmost', True)
        win.resizable(False, False)
        win.configure(bg='#181a24')
        pad = {'padx': 12}

        tk.Label(win, text='\u5927\u5c0f', bg='#181a24', fg='#ffffff',
                 font=(FONT, 10)).grid(row=0, column=0, sticky='w', pady=(12, 0), **pad)
        size_val = tk.Label(win, text=f"{int(self.settings['scale'] * 100)}%",
                            bg='#181a24', fg='#7cc7ff', font=(FONT, 10, 'bold'))
        size_val.grid(row=0, column=1, sticky='e', pady=(12, 0), **pad)
        size_scale = ttk.Scale(
            win, from_=50, to=200, orient='horizontal', length=240,
            command=lambda v: self.on_size_slider(v, size_val))
        size_scale.set(self.settings['scale'] * 100)
        size_scale.grid(row=1, column=0, columnspan=2, sticky='ew', pady=(0, 10), **pad)

        tk.Label(win, text='\u900f\u660e\u5ea6', bg='#181a24', fg='#ffffff',
                 font=(FONT, 10)).grid(row=2, column=0, sticky='w', **pad)
        op_val = tk.Label(win, text=f"{int(self.settings['opacity'] * 100)}%",
                          bg='#181a24', fg='#7cc7ff', font=(FONT, 10, 'bold'))
        op_val.grid(row=2, column=1, sticky='e', **pad)
        op_scale = ttk.Scale(
            win, from_=0, to=100, orient='horizontal', length=240,
            command=lambda v: self.on_opacity_slider(v, op_val))
        op_scale.set(self.settings['opacity'] * 100)
        op_scale.grid(row=3, column=0, columnspan=2, sticky='ew', pady=(0, 14), **pad)

        self.settings_win = win
        win.protocol('WM_DELETE_WINDOW', win.withdraw)

    def set_opacity(self, value):
        value = min(1.0, max(0.0, float(value)))
        self.settings['opacity'] = value
        self.apply_opacity()
        self.schedule_save()

    def set_panel(self, value):
        self.settings['panel'] = bool(value)
        save_settings(self.settings)

    def back_home(self):
        sw, sh = self.root.winfo_screenwidth(), self.root.winfo_screenheight()
        self.place(sw - self.sprite_w - 16, sh - self.sprite_h - BUBBLE_H - 16)
        self.home = (self.x, self.y)

    def on_right_click(self, event):
        try:
            self.menu.tk_popup(event.x_root, event.y_root)
        finally:
            self.menu.grab_release()

    # ---------- drag ----------
    def on_press(self, event):
        self.drag = {'sx': event.x_root, 'sy': event.y_root,
                     'wx': self.x, 'wy': self.y, 'moved': False, 'dir': 'left'}

    def on_drag_move(self, event):
        if self.drag is None:
            return
        dx = event.x_root - self.drag['sx']
        dy = event.y_root - self.drag['sy']
        if not self.drag['moved'] and abs(dx) + abs(dy) > 4:
            self.drag['moved'] = True
        if self.drag['moved']:
            self.drag['dir'] = 'left' if dx < 0 else 'right'
            self.place(self.drag['wx'] + dx, self.drag['wy'] + dy)
            self.home = (self.x, self.y)
            self.settings['x'] = self.x
            self.settings['y'] = self.y
            save_settings(self.settings)

    def on_release(self, event):
        if self.drag is None:
            return
        moved = self.drag['moved']
        self.drag = None
        if not moved:
            self.wave_until = time.time() + 2.6

    # ---------- hide / restore ----------
    def hide_pet(self, initial=False):
        self.settings['hidden'] = True
        if not initial:
            save_settings(self.settings)
        self.root.withdraw()
        if self.panel_win is not None:
            self.panel_win.withdraw()
        if self.restore_win is None:
            win = tk.Toplevel(self.root)
            win.overrideredirect(True)
            win.attributes('-topmost', True)
            win.configure(bg=MAGIC)
            try:
                win.attributes('-transparentcolor', MAGIC)
            except tk.TclError:
                pass
            dot = tk.Canvas(win, width=26, height=26, bg=MAGIC,
                            highlightthickness=0)
            dot.pack()
            dot.create_oval(1, 1, 25, 25, fill='#181a24', outline='#3c404d')
            dot.create_text(13, 13, text='\U0001f43e', font=(FONT, 11))
            dot.bind('<Button-1>', lambda e: self.show_pet())
            self.restore_win = win
        self.restore_win.geometry(f'+{self.x}+{self.y + self.sprite_h - 26}')
        self.restore_win.deiconify()

    def show_pet(self):
        self.settings['hidden'] = False
        save_settings(self.settings)
        self.restore_win.withdraw()
        self.root.deiconify()
        self.wave_until = time.time() + 2.2

    def quit_app(self):
        self.stop = True
        try:
            self.root.destroy()
        except tk.TclError:
            pass
        os._exit(0)

    # ---------- main loop ----------
    def tick(self):
        if self.stop:
            return
        now = time.time()

        state = self.pick_state()
        if state != self.state:
            self.state = state
            self.state_start = now
        _, frames, dur = STATES[state]
        frame_ms = dur / frames
        idx = int(((now - self.state_start) * 1000) // frame_ms) % frames
        self.set_sprite(state, idx, self.scale)

        bubble = self.pick_bubble(state, now)
        if self.panel_visible():
            bubble = ''
        self.set_bubble(bubble)

        self.refresh_panel()
        self.root.after(35, self.tick)


def main():
    FurinaPet()
    tk.mainloop()


if __name__ == '__main__':
    main()
