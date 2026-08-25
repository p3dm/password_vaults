"""
Windows Autofill Agent — Desktop autofill adapter cho Windows.

Trách nhiệm:
- Đăng ký global hotkey (Ctrl+Alt+A) để trigger autofill.
- Lấy thông tin active window/process qua Win32 API.
- Gọi CredentialService tìm candidate phù hợp.
- Hiển thị popup chọn credential (tkinter) nếu có nhiều candidate.
- Dùng clipboard + Ctrl+V để fill username/password (hỗ trợ Unicode).
- Xóa clipboard sau khi fill xong.

Quy tắc:
- Chỉ autofill sau hotkey (hành động rõ ràng của user).
- Không log password.
- Xóa reference payload ngay sau khi action hoàn tất.
"""

from __future__ import annotations

import logging
import threading
import time
import tkinter as tk
from tkinter import ttk

import keyboard
import pyautogui
import pyperclip
import psutil
import win32gui
import win32process

from app.autofill.base import AutofillAdapter
from app.autofill_matcher import AutofillContext
from app.credential_service import CredentialService

logger = logging.getLogger(__name__)

# ── Cấu hình mặc định ────────────────────────────────────────
AUTO_HOTKEY = "ctrl+f1"
SAVE_HOTKEY = "ctrl+f2"
FILL_DELAY_SEC = 0.3           # Delay giữa username và password
CLIPBOARD_CLEAR_DELAY = 2.0    # Xóa clipboard sau N giây
TYPE_PASTE_DELAY = 0.05        # Delay nhỏ sau mỗi Ctrl+V


class WindowsAdapter:
    """
    Desktop autofill agent cho Windows.

    Sử dụng:
        agent = WindowsAdapter()
        agent.start()     # đăng ký hotkey, bắt đầu lắng nghe
        ...
        agent.stop()      # hủy hotkey, cleanup
    """

    def __init__(
        self,
        auto_hotkey: str | None = None,
        save_hotkey: str | None = None,
    ):
        self._running = False
        self._service = CredentialService()
        self._target_hwnd: int | None = None  # handle window mục tiêu khi chọn candidate
        self._auto_hotkey = auto_hotkey or AUTO_HOTKEY
        self._save_hotkey = save_hotkey or SAVE_HOTKEY


    # ── Lifecycle ─────────────────────────────────────────────

    def start(self) -> None:
        """Đăng ký global hotkey và bắt đầu lắng nghe."""
        if self._running:
            logger.warning("WindowsAdapter đã đang chạy.")
            return

        keyboard.add_hotkey(self._auto_hotkey, self._on_hotkey, suppress=True)
        keyboard.add_hotkey(self._save_hotkey, self._on_save, suppress=True)

        self._running = True
        logger.info(
            "WindowsAdapter started — autofill: %s, save: %s",
            self._auto_hotkey,
            self._save_hotkey,
        )

    def stop(self) -> None:
        """Hủy hotkey và cleanup."""
        if not self._running:
            return

        for hk in (self._auto_hotkey, self._save_hotkey):
            try:
                keyboard.remove_hotkey(hk)
            except (KeyError, ValueError):
                pass  # hotkey đã bị hủy hoặc không tồn tại

        self._running = False
        logger.info("WindowsAdapter stopped.")

    # ── AutofillAdapter Protocol ──────────────────────────────

    def get_context(self) -> AutofillContext:
        """Lấy thông tin active window hiện tại qua Win32 API."""
        hwnd = win32gui.GetForegroundWindow()
        window_title = win32gui.GetWindowText(hwnd)

        process_name = ""
        try:
            _, pid = win32process.GetWindowThreadProcessId(hwnd)
            process_name = psutil.Process(pid).name()
        except (psutil.NoSuchProcess, psutil.AccessDenied, OSError) as e:
            logger.warning("Không lấy được process name: %s", e)

        return AutofillContext(
            source="desktop",
            process_name=process_name,
            window_title=window_title,
        )

    def fill(self, username: str, password: str) -> None:
        """
        Fill username + password vào active window bằng clipboard.

        Dùng clipboard + Ctrl+V thay vì typewrite() để hỗ trợ Unicode.
        Clear clipboard sau khi fill xong.
        """
        original_clipboard = ""
        try:
            original_clipboard = pyperclip.paste()
        except Exception:
            pass  # clipboard có thể rỗng hoặc chứa dữ liệu không phải text

        try:
            # Paste username
            pyperclip.copy(username)
            time.sleep(TYPE_PASTE_DELAY)
            pyautogui.hotkey("ctrl", "v")
            time.sleep(TYPE_PASTE_DELAY)

            # Tab sang field password
            pyautogui.press("tab")
            time.sleep(FILL_DELAY_SEC)

            # Paste password
            pyperclip.copy(password)
            time.sleep(TYPE_PASTE_DELAY)
            pyautogui.hotkey("ctrl", "v")
            time.sleep(TYPE_PASTE_DELAY)

            # Enter để submit
            pyautogui.press("enter")

        finally:
            # Xóa password khỏi clipboard sau delay
            def _clear_clipboard():
                time.sleep(CLIPBOARD_CLEAR_DELAY)
                try:
                    pyperclip.copy("")
                except Exception:
                    pass

            threading.Thread(target=_clear_clipboard, daemon=True).start()

    # ── Hotkey callback ───────────────────────────────────────

    def _on_hotkey(self) -> None:
        """
        Callback khi user nhấn hotkey.

        Luồng:
        1. Lưu handle của target window (để restore focus sau popup).
        2. Lấy context (process_name, window_title).
        3. Tìm candidate phù hợp.
        4. Nếu 0 candidate → thông báo không tìm thấy.
        5. Nếu 1 candidate → tự chọn.
        6. Nếu nhiều candidate → hiện popup cho user chọn.
        7. Lấy payload → restore focus → fill.
        """
        try:
            # Lưu target window handle
            self._target_hwnd = win32gui.GetForegroundWindow()

            context = self.get_context()
            logger.info(
                "Hotkey triggered — process: %s, window: %s",
                context.process_name,
                context.window_title,
            )

            candidates = self._service.find_autofill_candidates(context)

            if not candidates:
                logger.info("Không tìm thấy credential phù hợp.")
                self._show_notification("Không tìm thấy credential phù hợp.")
                return

            if len(candidates) == 1:
                # Chỉ 1 candidate → tự chọn
                self._execute_fill(candidates[0].credential_id)
            else:
                # Nhiều candidate → hiện popup
                self._show_candidate_popup(candidates)

        except Exception as e:
            logger.error("Lỗi trong _on_hotkey: %s", e, exc_info=True)
            self._show_notification(f"Lỗi autofill: {e}")

    # ── Popup chọn credential ─────────────────────────────────

    def _show_candidate_popup(self, candidates: list) -> None:
        """
        Hiển thị popup tkinter để user chọn credential.

        Popup hiện ở giữa màn hình, topmost, focus vào item đầu.
        Chọn bằng click đúp hoặc Enter. Esc để hủy.
        """
        def _run_popup():
            root = tk.Tk()
            root.title("Chọn Credential — Password Vault")
            root.attributes("-topmost", True)
            root.resizable(False, False)

            # ── Style ──────────────────────────────────────
            style = ttk.Style(root)
            style.theme_use("clam")
            root.configure(bg="#1e1e2e")

            style.configure(
                "Popup.TFrame",
                background="#1e1e2e",
            )
            style.configure(
                "Title.TLabel",
                background="#1e1e2e",
                foreground="#cdd6f4",
                font=("Segoe UI", 12, "bold"),
            )
            style.configure(
                "Hint.TLabel",
                background="#1e1e2e",
                foreground="#6c7086",
                font=("Segoe UI", 9),
            )
            style.configure(
                "Popup.Treeview",
                background="#313244",
                foreground="#cdd6f4",
                fieldbackground="#313244",
                font=("Segoe UI", 10),
                rowheight=32,
            )
            style.configure(
                "Popup.Treeview.Heading",
                background="#45475a",
                foreground="#cdd6f4",
                font=("Segoe UI", 10, "bold"),
            )
            style.map(
                "Popup.Treeview",
                background=[("selected", "#89b4fa")],
                foreground=[("selected", "#1e1e2e")],
            )

            # ── Frame chính ────────────────────────────────
            main_frame = ttk.Frame(root, style="Popup.TFrame", padding=16)
            main_frame.pack(fill=tk.BOTH, expand=True)

            title_label = ttk.Label(
                main_frame,
                text="🔐  Chọn credential để autofill",
                style="Title.TLabel",
            )
            title_label.pack(anchor=tk.W, pady=(0, 8))

            # ── Treeview danh sách candidate ────────────────
            columns = ("title", "username", "priority")
            tree = ttk.Treeview(
                main_frame,
                columns=columns,
                show="headings",
                height=min(len(candidates), 8),
                style="Popup.Treeview",
                selectmode="browse",
            )
            tree.heading("title", text="Tiêu đề")
            tree.heading("username", text="Username")
            tree.heading("priority", text="Ưu tiên")
            tree.column("title", width=200, minwidth=150)
            tree.column("username", width=200, minwidth=150)
            tree.column("priority", width=70, minwidth=50, anchor=tk.CENTER)

            for candidate in candidates:
                fav_marker = "⭐ " if candidate.favorite else ""
                tree.insert(
                    "",
                    tk.END,
                    iid=candidate.credential_id,
                    values=(
                        f"{fav_marker}{candidate.title}",
                        candidate.username,
                        candidate.priority,
                    ),
                )

            tree.pack(fill=tk.BOTH, expand=True, pady=(0, 8))

            # Chọn item đầu tiên
            first_item = tree.get_children()[0]
            tree.selection_set(first_item)
            tree.focus(first_item)

            hint_label = ttk.Label(
                main_frame,
                text="Enter để chọn  ·  Esc để hủy",
                style="Hint.TLabel",
            )
            hint_label.pack(anchor=tk.E)

            # ── Event handlers ──────────────────────────────
            def _on_select(event=None):
                selection = tree.selection()
                if selection:
                    credential_id = selection[0]
                    root.destroy()
                    self._execute_fill(credential_id)

            def _on_cancel(event=None):
                root.destroy()

            tree.bind("<Double-1>", _on_select)
            tree.bind("<Return>", _on_select)
            root.bind("<Escape>", _on_cancel)

            # Đặt popup giữa màn hình
            root.update_idletasks()
            w = root.winfo_width()
            h = root.winfo_height()
            x = (root.winfo_screenwidth() // 2) - (w // 2)
            y = (root.winfo_screenheight() // 2) - (h // 2)
            root.geometry(f"+{x}+{y}")

            tree.focus_set()
            root.mainloop()

        # Chạy popup trong thread riêng để không block hotkey listener
        popup_thread = threading.Thread(target=_run_popup, daemon=True)
        popup_thread.start()

    # ── Thực thi fill ─────────────────────────────────────────

    def _execute_fill(self, credential_id: str) -> None:
        """
        Lấy payload và fill vào target window.

        Luồng:
        1. Lấy autofill payload (username/password) từ CredentialService.
        2. Restore focus về target window đã lưu.
        3. Delay nhỏ để window nhận focus.
        4. Gọi fill() để paste vào các field.
        5. Xóa reference payload khỏi memory.
        """
        payload = None
        try:
            payload = self._service.get_autofill_payload(credential_id)

            # Restore focus về target window
            if self._target_hwnd:
                try:
                    win32gui.SetForegroundWindow(self._target_hwnd)
                    time.sleep(0.5)  # chờ window nhận focus
                except Exception as e:
                    logger.warning("Không restore được focus: %s", e)

            self.fill(payload["username"], payload["password"])
            logger.info("Autofill thành công cho credential: %s", credential_id)

        except Exception as e:
            logger.error("Autofill thất bại: %s", e, exc_info=True)
            self._show_notification(f"Autofill thất bại: {e}")
        finally:
            # Xóa reference payload khỏi memory
            if payload:
                payload.clear()
            payload = None
    
    # ── Save password hotkey callback ──────────────────────────

    def _on_save(self) -> None:
        """
        Callback khi user nhấn save hotkey.

        Luồng:
        1. Lưu handle của target window.
        2. Lấy context (process_name, window_title).
        3. Hiện popup form để user nhập thông tin credential.
        4. Gọi service.save_password() với credential + context.
        """
        try:
            self._target_hwnd = win32gui.GetForegroundWindow()
            self._save_context = self.get_context()
            logger.info(
                "Save hotkey triggered — process: %s, window: %s",
                self._save_context.process_name,
                self._save_context.window_title,
            )
            self._show_save_popup()
        except Exception as e:
            logger.error("Lỗi trong _on_save: %s", e, exc_info=True)
            self._show_notification(f"Lỗi save password: {e}")

    def _show_save_popup(self) -> None:
        """
        Hiển thị popup tkinter để user nhập thông tin credential cần lưu.

        Form gồm: title, username, password, platform_type.
        Sau khi submit → gọi _execute_save().
        """
        context = self._save_context

        def _run_popup():
            root = tk.Tk()
            root.title("Lưu Credential — Password Vault")
            root.attributes("-topmost", True)
            root.resizable(False, False)

            # ── Style ──────────────────────────────────────
            style = ttk.Style(root)
            style.theme_use("clam")
            root.configure(bg="#1e1e2e")

            style.configure("Save.TFrame", background="#1e1e2e")
            style.configure(
                "Save.TLabel",
                background="#1e1e2e",
                foreground="#cdd6f4",
                font=("Segoe UI", 10),
            )
            style.configure(
                "SaveTitle.TLabel",
                background="#1e1e2e",
                foreground="#cdd6f4",
                font=("Segoe UI", 12, "bold"),
            )
            style.configure(
                "Save.TEntry",
                fieldbackground="#313244",
                foreground="#cdd6f4",
                font=("Segoe UI", 10),
            )
            style.configure(
                "Save.TButton",
                background="#89b4fa",
                foreground="#1e1e2e",
                font=("Segoe UI", 10, "bold"),
                padding=(12, 6),
            )
            style.map(
                "Save.TButton",
                background=[("active", "#74c7ec")],
            )
            style.configure(
                "Cancel.TButton",
                background="#45475a",
                foreground="#cdd6f4",
                font=("Segoe UI", 10),
                padding=(12, 6),
            )
            style.map(
                "Cancel.TButton",
                background=[("active", "#585b70")],
            )

            # ── Frame chính ────────────────────────────────
            main_frame = ttk.Frame(root, style="Save.TFrame", padding=20)
            main_frame.pack(fill=tk.BOTH, expand=True)

            ttk.Label(
                main_frame,
                text="💾  Lưu credential mới",
                style="SaveTitle.TLabel",
            ).grid(row=0, column=0, columnspan=2, sticky=tk.W, pady=(0, 12))

            # Hiển thị context info
            context_text = context.process_name or context.window_title or "N/A"
            ttk.Label(
                main_frame,
                text=f"Target: {context_text}",
                style="Save.TLabel",
            ).grid(row=1, column=0, columnspan=2, sticky=tk.W, pady=(0, 8))

            # ── Form fields ────────────────────────────────
            fields = {}
            field_defs = [
                ("title", "Tiêu đề", context.process_name or ""),
                ("username", "Username", ""),
                ("password", "Password", ""),
            ]

            for i, (key, label_text, default) in enumerate(field_defs, start=2):
                ttk.Label(
                    main_frame, text=label_text, style="Save.TLabel"
                ).grid(row=i, column=0, sticky=tk.W, pady=4, padx=(0, 12))

                entry = ttk.Entry(main_frame, width=35, style="Save.TEntry")
                if key == "password":
                    entry.configure(show="•")
                if default:
                    entry.insert(0, default)
                entry.grid(row=i, column=1, sticky=tk.EW, pady=4)
                fields[key] = entry

            # Platform type
            row_platform = len(field_defs) + 2
            ttk.Label(
                main_frame, text="Loại nền tảng", style="Save.TLabel"
            ).grid(row=row_platform, column=0, sticky=tk.W, pady=4, padx=(0, 12))

            platform_combo = ttk.Combobox(
                main_frame,
                values=["web", "desktop_app", "other"],
                state="readonly",
                width=32,
            )
            platform_combo.set("desktop_app")
            platform_combo.grid(row=row_platform, column=1, sticky=tk.EW, pady=4)

            # Error message label
            error_label = ttk.Label(
                main_frame,
                text="",
                foreground="#f38ba8",
                background="#1e1e2e",
                font=("Segoe UI", 9),
            )
            error_label.grid(row=row_platform + 1, column=0, columnspan=2, sticky=tk.W, pady=(4, 0))

            # ── Buttons ────────────────────────────────────
            btn_frame = ttk.Frame(main_frame, style="Save.TFrame")
            btn_frame.grid(
                row=row_platform + 2, column=0, columnspan=2,
                sticky=tk.E, pady=(12, 0),
            )

            def _on_submit(event=None):
                credential = {
                    "title": fields["title"].get().strip(),
                    "username": fields["username"].get().strip(),
                    "password": fields["password"].get(),
                    "platform_type": platform_combo.get(),
                    "platform_identifier": context.process_name,
                }

                if not credential["title"] or not credential["username"] or not credential["password"]:
                    error_label.config(text="Vui lòng điền đầy đủ thông tin.")
                    return

                root.destroy()
                self._execute_save(credential)

            def _on_cancel(event=None):
                root.destroy()

            ttk.Button(
                btn_frame, text="Hủy", style="Cancel.TButton", command=_on_cancel
            ).pack(side=tk.LEFT, padx=(0, 8))
            ttk.Button(
                btn_frame, text="Lưu", style="Save.TButton", command=_on_submit
            ).pack(side=tk.LEFT)

            root.bind("<Return>", _on_submit)
            root.bind("<Escape>", _on_cancel)

            # Đặt popup giữa màn hình
            root.update_idletasks()
            w = root.winfo_width()
            h = root.winfo_height()
            x = (root.winfo_screenwidth() // 2) - (w // 2)
            y = (root.winfo_screenheight() // 2) - (h // 2)
            root.geometry(f"+{x}+{y}")

            # Focus vào field đầu tiên
            fields["title"].focus_set()
            root.mainloop()

        popup_thread = threading.Thread(target=_run_popup, daemon=True)
        popup_thread.start()

    def _execute_save(self, credential: dict) -> None:
        """
        Thực hiện lưu credential + autofill rules.

        Luồng:
        1. Gọi service.save_password() với credential + context đã lưu.
        2. Hiển thị notification kết quả.
        """
        try:
            context = getattr(self, "_save_context", None)
            if not context:
                logger.error("Không có context để save")
                self._show_notification(
                    "Save password thất bại: không xác định được target window"
                )
                return

            self._service.save_password(credential, context)
            self._show_notification("Save password thành công! ✅")
            logger.info("Save password thành công: %s", credential.get("title"))
        except Exception as e:
            logger.error("Save password thất bại: %s", e, exc_info=True)
            self._show_notification(f"Save password thất bại: {e}")
        finally:
            self._save_context = None

    # ── Notification helper ───────────────────────────────────

    @staticmethod
    def _show_notification(message: str) -> None:
        """Hiển thị thông báo ngắn bằng tkinter Toplevel (toast-like)."""
        def _run():
            root = tk.Tk()
            root.overrideredirect(True)
            root.attributes("-topmost", True)
            root.configure(bg="#1e1e2e")

            frame = tk.Frame(root, bg="#1e1e2e", padx=20, pady=12)
            frame.pack()

            label = tk.Label(
                frame,
                text=message,
                bg="#1e1e2e",
                fg="#cdd6f4",
                font=("Segoe UI", 11),
                wraplength=350,
            )
            label.pack()

            # Đặt ở góc phải dưới màn hình
            root.update_idletasks()
            w = root.winfo_width()
            h = root.winfo_height()
            screen_w = root.winfo_screenwidth()
            screen_h = root.winfo_screenheight()
            x = screen_w - w - 20
            y = screen_h - h - 60
            root.geometry(f"+{x}+{y}")

            # Tự đóng sau 3 giây
            root.after(3000, root.destroy)
            root.mainloop()

        threading.Thread(target=_run, daemon=True).start()
