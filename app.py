import os
import re
import shutil
import subprocess
import uuid
import zipfile
import json
import threading
import queue
import time
import signal
import logging
from flask import Flask, request, jsonify, send_from_directory, render_template, session, redirect, url_for, Response
import yt_dlp
from datetime import datetime

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ============================================================================== 
# APP INITIALIZATION & CONFIGURATION
# ==============================================================================

app = Flask(__name__, static_folder='static', template_folder='templates')

# --- Configuration ---
DOWNLOAD_FOLDER = os.path.join(os.getcwd(), 'downloads')
os.makedirs(DOWNLOAD_FOLDER, exist_ok=True)

app.config['SECRET_KEY'] = 'your-very-secret-and-random-key-12345'
ADMIN_USERNAME = 'admin'
ADMIN_PASSWORD = 'password'

# Track active downloads
active_downloads = {}


# ============================================================================== 
# HELPER FUNCTIONS
# ==============================================================================

def sanitize_filename(title):
    """Removes illegal characters from a string to make it a valid filename."""
    if not title: return "untitled"
    s = re.sub(r'[<>:"/\\|?*]', '', title)
    s = re.sub(r'\s+', '_', s).strip('_')
    return s[:100]

def get_video_info(url, quick_fetch=False):
    """Extracts video or playlist information using yt-dlp."""
    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": "in_playlist" if quick_fetch else False,
        "http_headers": {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        }
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        try:
            return ydl.extract_info(url, download=False)
        except Exception as e:
            logger.error(f"yt-dlp error: {e}")
            return None

def get_best_audio_format(info):
    """Get the best available audio format with fallback options."""
    if not info or 'formats' not in info:
        return None
    
    audio_formats = [
        f for f in info.get('formats', [])
        if f.get('acodec') != 'none' and f.get('vcodec') == 'none'
    ]
    
    if not audio_formats:
        # Fallback: look for combined formats with audio
        combined_formats = [
            f for f in info.get('formats', [])
            if f.get('acodec') != 'none' and f.get('vcodec') != 'none'
        ]
        if combined_formats:
            # Use the best combined format as audio source
            return sorted(combined_formats, key=lambda x: x.get('quality', 0), reverse=True)[0].get('format_id')
        return None
    
    # Sort by audio bitrate/quality and return the best
    best_audio = sorted(audio_formats, key=lambda x: x.get('abr', 0), reverse=True)[0]
    return best_audio.get('format_id')

def validate_downloaded_file(file_path, min_size_mb=0.1):
    """Validate that a downloaded file exists and has reasonable size."""
    if not os.path.exists(file_path):
        return False
    
    file_size = os.path.getsize(file_path)
    min_size_bytes = min_size_mb * 1024 * 1024
    
    return file_size >= min_size_bytes

def process_formats(formats):
    """Processes the raw format list for the single video view."""
    video_formats, audio_formats = {}, {}
    for f in formats:
        filesize = f.get('filesize') or f.get('filesize_approx')
        filesize_str = f"{filesize / 1024 / 1024:.2f} MB" if filesize else "N/A"
        if f.get('vcodec') != 'none':
            res = f.get('format_note') or (str(f.get('height')) + 'p' if f.get('height') else 'N/A')
            if res not in video_formats:
                video_formats[res] = {'format_id': f['format_id'], 'resolution': res, 'ext': f['ext'], 'filesize': filesize_str, 'type': 'video_only' if f.get('acodec') == 'none' else 'combined'}
        if f.get('acodec') != 'none' and f.get('vcodec') == 'none':
            q = f.get('format_note') or f"{f.get('abr', 0)}k"
            if q not in audio_formats:
                audio_formats[q] = {'format_id': f['format_id'], 'quality': q, 'ext': f['ext'], 'filesize': filesize_str, 'type': 'audio'}
    sorted_videos = sorted(video_formats.values(), key=lambda x: (int(re.sub(r'\D', '', x['resolution'])) if re.sub(r'\D', '', x['resolution']).isdigit() else 0), reverse=True)
    sorted_audios = sorted(audio_formats.values(), key=lambda x: (int(re.sub(r'\D', '', x['quality'])) if re.sub(r'\D', '', x['quality']).isdigit() else 0), reverse=True)
    return sorted_videos, sorted_audios

def merge_video_audio(video_file, audio_file, output_file):
    """
    Merges separate video and audio files using FFmpeg with robust error handling.

    Strategy:
      1) Validate input files exist and are readable
      2) Try to copy video stream and encode audio to AAC: fastest and preserves video quality
      3) If that fails, fallback to re-encoding video to libx264 and audio to aac for maximum compatibility
      4) If both fail, try basic merge without specific codec settings
    """
    # Validate input files
    if not os.path.exists(video_file):
        logger.error(f"Video file not found: {video_file}")
        return False
    if not os.path.exists(audio_file):
        logger.error(f"Audio file not found: {audio_file}")
        return False
    
    # Check file sizes
    video_size = os.path.getsize(video_file)
    audio_size = os.path.getsize(audio_file)
    
    if video_size < 512:  # Less than 512 bytes
        logger.error(f"Video file too small: {video_size} bytes")
        return False
    if audio_size < 512:  # Less than 512 bytes
        logger.error(f"Audio file too small: {audio_size} bytes")
        return False
    
    logger.info(f"Merging video ({video_size/1024/1024:.1f}MB) with audio ({audio_size/1024/1024:.1f}MB)")
    
    # Primary attempt: copy video stream, encode audio to aac
    cmd_primary = [
        'ffmpeg', '-y',
        '-i', video_file,
        '-i', audio_file,
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-shortest',
        '-avoid_negative_ts', 'make_zero',
        output_file
    ]

    # Fallback: re-encode video + audio to compatible codecs
    cmd_fallback = [
        'ffmpeg', '-y',
        '-i', video_file,
        '-i', audio_file,
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '23',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-shortest',
        '-avoid_negative_ts', 'make_zero',
        output_file
    ]
    
    # Last resort: basic merge
    cmd_basic = [
        'ffmpeg', '-y',
        '-i', video_file,
        '-i', audio_file,
        '-shortest',
        output_file
    ]

    try:
        # Try primary approach
        logger.info("Attempting primary merge (copy video, encode audio)")
        proc = subprocess.run(cmd_primary, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=300)
        if proc.returncode == 0 and os.path.exists(output_file) and os.path.getsize(output_file) > 1024:
            logger.info("Primary merge successful")
            return True
        else:
            logger.warning(f"Primary merge failed (return code: {proc.returncode}). stderr: {proc.stderr[:500]}")
            
            # Clean up failed output
            if os.path.exists(output_file):
                try:
                    os.remove(output_file)
                except:
                    pass
            
            # Try fallback approach
            logger.info("Attempting fallback merge (re-encode both streams)")
            proc2 = subprocess.run(cmd_fallback, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=600)
            if proc2.returncode == 0 and os.path.exists(output_file) and os.path.getsize(output_file) > 1024:
                logger.info("Fallback merge successful")
                return True
            else:
                logger.warning(f"Fallback merge failed (return code: {proc2.returncode}). stderr: {proc2.stderr[:500]}")
                
                # Clean up failed output
                if os.path.exists(output_file):
                    try:
                        os.remove(output_file)
                    except:
                        pass
                
                # Try basic merge as last resort
                logger.info("Attempting basic merge (no codec specification)")
                proc3 = subprocess.run(cmd_basic, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=600)
                if proc3.returncode == 0 and os.path.exists(output_file) and os.path.getsize(output_file) > 1024:
                    logger.info("Basic merge successful")
                    return True
                else:
                    logger.error(f"All merge attempts failed. Basic merge stderr: {proc3.stderr[:500]}")
                    return False
                    
    except subprocess.TimeoutExpired:
        logger.error("FFmpeg merge timed out")
        return False
    except FileNotFoundError as fnf:
        logger.error(f"FFmpeg not found on system PATH: {fnf}")
        return False
    except Exception as e:
        logger.error(f"Unexpected FFmpeg error: {e}")
        return False

def format_duration(seconds):
    if seconds is None: return "N/A"
    h = int(seconds // 3600); m = int((seconds % 3600) // 60); s = int(seconds % 60)
    return f"{h:02}:{m:02}:{s:02}" if h > 0 else f"{m:02}:{s:02}"

def format_upload_date(date_str):
    if date_str is None: return "N/A"
    try: return datetime.strptime(date_str, '%Y%m%d').strftime('%b %d, %Y')
    except ValueError: return "N/A"

def get_embeddable_url(info):
    extractor = info.get('extractor_key', '').lower(); video_id = info.get('id')
    if 'youtube' in extractor: return f"https://www.youtube.com/embed/{video_id}"
    if 'dailymotion' in extractor: return f"https://www.dailymotion.com/embed/video/{video_id}"
    return None

# ============================================================================== 
# MIDDLEWARE & AUTHENTICATION (No Changes)
# ============================================================================== 
@app.after_request
def add_no_cache_headers(response):
    response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response

@app.before_request
def require_login():
    allowed_routes = ['login', 'static']
    if request.endpoint not in allowed_routes and not session.get('logged_in'):
        return redirect(url_for('login'))

@app.route('/login', methods=['GET', 'POST'])
def login():
    if session.get('logged_in'): return redirect(url_for('index'))
    if request.method == 'POST':
        if request.form.get('username') == ADMIN_USERNAME and request.form.get('password') == ADMIN_PASSWORD:
            session['logged_in'] = True
            return redirect(url_for('index'))
        else:
            return render_template('login.html', error='Invalid credentials. Please try again.')
    return render_template('login.html')

@app.route('/logout')
def logout():
    session.pop('logged_in', None)
    return redirect(url_for('login'))

# ============================================================================== 
# STATIC PAGE ROUTES (No Changes)
# ============================================================================== 
@app.route('/')
def index(): return render_template('index.html')

@app.route('/history')
def history(): return render_template('history.html')

@app.route('/about')
def about(): return render_template('about.html')

@app.route('/faq')
def faq(): return render_template('faq.html')

@app.route('/contact')
def contact(): return render_template('contact.html')

@app.route('/policy')
def policy(): return render_template('policy.html')

@app.route('/terms')
def terms(): return render_template('terms.html')

# ============================================================================== 
# API & DOWNLOAD ROUTES
# ============================================================================== 

@app.route('/api/fetch_info', methods=['POST'])
def fetch_info():
    """Universal endpoint to fetch info for either a single video or a playlist."""
    url = request.json.get('url')
    if not url: return jsonify({'error': 'URL is required'}), 400

    # First, quickly check if it's a playlist
    is_playlist = 'list=' in url or '/playlist/' in url or '/sets/' in url

    info = get_video_info(url, quick_fetch=is_playlist)
    if not info:
        return jsonify({'error': 'Unable to fetch info. The URL may be invalid or unsupported.'}), 500

    # If the response indicates a playlist, handle it as a playlist
    if 'entries' in info or info.get('_type') == 'playlist':
        entries = [e for e in info.get('entries', []) if e]
        thumbnail = info.get('thumbnail')
        if not thumbnail and entries and entries[0]:
            # Fallback: get thumbnail from the first video
            first_video_info = get_video_info(entries[0]['url'])
            if first_video_info: thumbnail = first_video_info.get('thumbnail')
        
        return jsonify({
            'type': 'playlist',
            'title': info.get('title', 'Playlist'),
            'author': info.get('uploader', 'Unknown Artist'),
            'thumbnail': thumbnail, 
            'video_count': len(entries),
            'original_url': info.get('webpage_url'),
            'videos': [{'id': v.get('id'), 'title': v.get('title', 'Untitled'), 'url': v.get('url'), 'duration': format_duration(v.get('duration'))} for v in entries if v]
        })
    
    # Otherwise, handle it as a single video
    else:
        video_formats, audio_formats = process_formats(info.get('formats', []))
        author_url = info.get('channel_url') or info.get('uploader_url')
        if author_url and not author_url.startswith(('http://', 'https://')): author_url = None
        return jsonify({
            'type': 'video',
            'title': info.get('title', 'No Title'),'author': info.get('uploader', 'Unknown Author'),'author_url': author_url,
            'platform': info.get('extractor_key', 'Unknown'),'thumbnail': info.get('thumbnail'),
            'original_url': info.get('webpage_url'),'embed_url': get_embeddable_url(info),
            'duration': format_duration(info.get('duration')),'upload_date': format_upload_date(info.get('upload_date')),
            'like_count': f"{info.get('like_count') or 0:,}",'video_formats': video_formats,'audio_formats': audio_formats,
            'best_audio_id': audio_formats[0]['format_id'] if audio_formats else None
    })

@app.route('/cancel_download', methods=['POST'])
def cancel_download():
    """Cancels an active download."""
    session_id = request.json.get('session_id')
    if not session_id:
        return jsonify({'error': 'Session ID required'}), 400
    
    if session_id in active_downloads:
        active_downloads[session_id]['cancelled'] = True
        return jsonify({'success': True})
    
    return jsonify({'error': 'Download not found'}), 404

@app.route('/stream_single_download')
def stream_single_download():
    """Handles single video download with real-time progress updates."""
    url = request.args.get('url')
    format_id = request.args.get('format_id')
    title = request.args.get('title')
    file_type = request.args.get('type')
    best_audio_id = request.args.get('best_audio_id')

    if not all([url, format_id, title, file_type]):
        return Response("Missing required parameters", status=400)

    def generate():
        safe_title = sanitize_filename(title)
        session_id = str(uuid.uuid4())
        
        # Track this download
        active_downloads[session_id] = {'cancelled': False, 'process': None}
        
        # Initialize variables outside try block
        nonlocal best_audio_id
        progress_data = {'video_done': False, 'audio_done': False, 'current_progress': None, 'should_stop': False}
        
        try:
            yield f"data: {json.dumps({'status': 'starting', 'message': 'Initializing download...'})}\n\n"
            
            # Initialize best_audio_id if needed
            if not best_audio_id:
                info = get_video_info(url)
                if info:
                    best_audio_id = get_best_audio_format(info)
            
            def progress_hook(d):
                # Check if cancelled at every progress update
                if active_downloads.get(session_id, {}).get('cancelled'):
                    raise yt_dlp.DownloadError("Download cancelled by user")
                    
                if d['status'] == 'downloading':
                    downloaded = d.get('downloaded_bytes', 0)
                    total = d.get('total_bytes') or d.get('total_bytes_estimate', 0)
                    speed = d.get('speed', 0)
                    eta = d.get('eta', 0)
                    
                    if total > 0:
                        percent = (downloaded / total) * 100
                        speed_str = f"{speed / 1024 / 1024:.1f} MB/s" if speed else "N/A"
                        size_str = f"{downloaded / 1024 / 1024:.1f} MB / {total / 1024 / 1024:.1f} MB"
                        if eta:
                            eta_mins = int(eta // 60)
                            eta_secs = int(eta % 60)
                            eta_str = f"{eta_mins:02d}:{eta_secs:02d}"
                        else:
                            eta_str = "N/A"
                        
                        phase = 'video' if not progress_data['video_done'] else 'audio'
                        message = f"Downloading {phase}... {percent:.1f}%"
                        
                        progress_data['current_progress'] = {
                            'status': 'downloading',
                            'phase': phase,
                            'progress': percent,
                            'speed': speed_str,
                            'size': size_str,
                            'eta': eta_str,
                            'message': message,
                            'session_id': session_id
                        }
                        
                elif d['status'] == 'finished':
                    if not progress_data['video_done']:
                        progress_data['video_done'] = True
                    else:
                        progress_data['audio_done'] = True
            
            def progress_sender():
                while not progress_data['should_stop']:
                    if progress_data['current_progress']:
                        try:
                            yield f"data: {json.dumps(progress_data['current_progress'])}\n\n"
                        except:
                            pass
                    time.sleep(0.5)
            
            # Start progress sender in background
            import queue
            progress_queue = queue.Queue()
            
            def queue_progress():
                while not progress_data['should_stop'] and not active_downloads.get(session_id, {}).get('cancelled'):
                    if progress_data['current_progress']:
                        progress_queue.put(progress_data['current_progress'])
                    time.sleep(0.5)
            
            progress_thread = threading.Thread(target=queue_progress, daemon=True)
            progress_thread.start()

            fallback_selector = "bv*+ba/b"
            final_file_path = None

            if file_type != 'video_only':
                yield f"data: {json.dumps({'status': 'downloading', 'phase': 'video', 'progress': 0, 'message': 'Starting download...'})}\n\n"
                
                outtmpl = os.path.join(DOWNLOAD_FOLDER, f"{safe_title}_{session_id}.%(ext)s")
                # Custom hook to check cancellation more frequently
                def cancellation_hook(d):
                    if active_downloads.get(session_id, {}).get('cancelled'):
                        raise yt_dlp.DownloadError("Download cancelled by user")
                    progress_hook(d)
                
                ydl_opts = {
                    'format': f"{format_id}/{fallback_selector}",
                    'outtmpl': outtmpl,
                    'merge_output_format': 'mp4',
                    'progress_hooks': [cancellation_hook],
                    'hookwarning': False,
                    'http_headers': {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                    }
                }
                
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    # Start sending progress updates
                    start_time = time.time()
                    
                    def download_with_check():
                        try:
                            ydl.download([url])
                        except yt_dlp.DownloadError as e:
                            if "cancelled" in str(e).lower():
                                return  # Exit gracefully on cancellation
                            raise e
                        except Exception as e:
                            if active_downloads.get(session_id, {}).get('cancelled'):
                                return  # Exit gracefully on cancellation
                            raise e
                    
                    # Download in separate thread to allow progress updates
                    download_thread = threading.Thread(target=download_with_check)
                    download_thread.start()
                    
                    # Send progress updates while downloading
                    while download_thread.is_alive():
                        if active_downloads.get(session_id, {}).get('cancelled'):
                            yield f"data: {json.dumps({'status': 'cancelled', 'message': 'Download cancelled'})}\n\n"
                            return
                        try:
                            progress = progress_queue.get_nowait()
                            yield f"data: {json.dumps(progress)}\n\n"
                        except queue.Empty:
                            pass
                        time.sleep(0.2)
                    
                    download_thread.join()
                    
                    # Send any remaining progress updates
                    while not progress_queue.empty():
                        try:
                            progress = progress_queue.get_nowait()
                            yield f"data: {json.dumps(progress)}\n\n"
                        except queue.Empty:
                            break

                candidates = [
                    os.path.join(DOWNLOAD_FOLDER, f)
                    for f in os.listdir(DOWNLOAD_FOLDER)
                    if session_id in f
                ]
                if not candidates:
                    yield f"data: {json.dumps({'status': 'error', 'message': 'Download failed (no output file).'})}\n\n"
                    return
                    
                final_file_path = max(candidates, key=os.path.getctime)
                yield f"data: {json.dumps({'status': 'completed', 'progress': 100, 'message': 'Download completed!'})}\n\n"

            else:
                # Video only - download video + audio separately and merge
                yield f"data: {json.dumps({'status': 'downloading', 'phase': 'video', 'progress': 0, 'message': 'Downloading video...'})}\n\n"
                
                # Get fresh video info to ensure we have the best audio format
                if not best_audio_id:
                    info = get_video_info(url)
                    if info:
                        best_audio_id = get_best_audio_format(info)
                
                video_out = os.path.join(DOWNLOAD_FOLDER, f"{safe_title}_video_{session_id}.%(ext)s")
                # Custom hook to check cancellation more frequently
                def video_cancellation_hook(d):
                    if active_downloads.get(session_id, {}).get('cancelled'):
                        raise yt_dlp.DownloadError("Download cancelled by user")
                    progress_hook(d)
                
                try:
                    with yt_dlp.YoutubeDL({
                        'format': f"{format_id}/{fallback_selector}",
                        'outtmpl': video_out,
                        'progress_hooks': [video_cancellation_hook],
                        'hookwarning': False,
                        'ignoreerrors': False,
                        'http_headers': {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                        }
                    }) as ydl:
                        def download_video():
                            try:
                                ydl.download([url])
                            except yt_dlp.DownloadError as e:
                                if "cancelled" in str(e).lower():
                                    return  # Exit gracefully on cancellation
                                raise e
                            except Exception as e:
                                if active_downloads.get(session_id, {}).get('cancelled'):
                                    return  # Exit gracefully on cancellation
                                raise e
                        
                        # Download video with progress updates
                        download_thread = threading.Thread(target=download_video)
                        download_thread.start()
                        
                        while download_thread.is_alive():
                            if active_downloads.get(session_id, {}).get('cancelled'):
                                yield f"data: {json.dumps({'status': 'cancelled', 'message': 'Download cancelled'})}\n\n"
                                return
                            try:
                                progress = progress_queue.get_nowait()
                                yield f"data: {json.dumps(progress)}\n\n"
                            except queue.Empty:
                                pass
                            time.sleep(0.2)
                        
                        download_thread.join()
                        
                        # Clear remaining progress
                        while not progress_queue.empty():
                            try:
                                progress_queue.get_nowait()
                            except queue.Empty:
                                break
                except Exception as e:
                    logger.error(f"Video download failed: {e}")
                    yield f"data: {json.dumps({'status': 'error', 'message': f'Video download failed: {str(e)}'})}\n\n"
                    return

                video_candidates = [f for f in os.listdir(DOWNLOAD_FOLDER) if f"video_{session_id}" in f]
                if not video_candidates:
                    yield f"data: {json.dumps({'status': 'error', 'message': 'Video download failed - no output file found.'})}\n\n"
                    return
                    
                video_file = max(video_candidates, key=lambda f: os.path.getctime(os.path.join(DOWNLOAD_FOLDER, f)))
                video_path = os.path.join(DOWNLOAD_FOLDER, video_file)
                
                # Validate video file
                if not validate_downloaded_file(video_path, 0.01):  # 10KB minimum
                    yield f"data: {json.dumps({'status': 'completed', 'progress': 100, 'message': 'Download completed!'})}\n\n"
                    final_file_path = video_path
                
                # Reset progress for audio phase
                progress_data['current_progress'] = None
                yield f"data: {json.dumps({'status': 'downloading', 'phase': 'audio', 'progress': 0, 'message': 'Downloading audio...'})}\n\n"

                audio_out = os.path.join(DOWNLOAD_FOLDER, f"{safe_title}_audio_{session_id}.%(ext)s")
                # Custom hook to check cancellation more frequently
                def audio_cancellation_hook(d):
                    if active_downloads.get(session_id, {}).get('cancelled'):
                        raise yt_dlp.DownloadError("Download cancelled by user")
                    progress_hook(d)
                
                audio_downloaded = False
                if best_audio_id:
                    try:
                        with yt_dlp.YoutubeDL({
                            'format': f"{best_audio_id}/{fallback_selector}",
                            'outtmpl': audio_out,
                            'progress_hooks': [audio_cancellation_hook],
                            'hookwarning': False,
                            'ignoreerrors': False,
                            'http_headers': {
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                            }
                        }) as ydl:
                            def download_audio():
                                try:
                                    ydl.download([url])
                                    return True
                                except yt_dlp.DownloadError as e:
                                    if "cancelled" in str(e).lower():
                                        return False  # Exit gracefully on cancellation
                                    logger.error(f"Audio download error: {e}")
                                    return False
                                except Exception as e:
                                    if active_downloads.get(session_id, {}).get('cancelled'):
                                        return False  # Exit gracefully on cancellation
                                    logger.error(f"Audio download exception: {e}")
                                    return False
                            
                            # Download audio with progress updates
                            download_result = [False]
                            def download_wrapper():
                                download_result[0] = download_audio()
                            
                            download_thread = threading.Thread(target=download_wrapper)
                            download_thread.start()
                            
                            while download_thread.is_alive():
                                if active_downloads.get(session_id, {}).get('cancelled'):
                                    yield f"data: {json.dumps({'status': 'cancelled', 'message': 'Download cancelled'})}\n\n"
                                    return
                                try:
                                    progress = progress_queue.get_nowait()
                                    yield f"data: {json.dumps(progress)}\n\n"
                                except queue.Empty:
                                    pass
                                time.sleep(0.2)
                            
                            download_thread.join()
                            audio_downloaded = download_result[0]
                            
                            # Clear remaining progress
                            while not progress_queue.empty():
                                try:
                                    progress_queue.get_nowait()
                                except queue.Empty:
                                    break
                    except Exception as e:
                        logger.error(f"Audio download setup failed: {e}")
                        audio_downloaded = False

                if not audio_downloaded:
                    # Fallback: try to extract audio from video file itself
                    yield f"data: {json.dumps({'status': 'processing', 'phase': 'fallback', 'progress': 50, 'message': 'Audio download failed, trying to extract from video...'})}\n\n"
                    
                    # Check if video has embedded audio
                    try:
                        import subprocess
                        probe_cmd = ['ffprobe', '-v', 'quiet', '-show_streams', '-select_streams', 'a', video_path]
                        result = subprocess.run(probe_cmd, capture_output=True, text=True)
                        
                        if result.returncode == 0 and result.stdout.strip():
                            # Video has audio, use it directly as final output
                            final_file_path = os.path.join(DOWNLOAD_FOLDER, f"{safe_title}_{session_id}.mp4")
                            shutil.copy2(video_path, final_file_path)
                            try: os.remove(video_path)
                            except: pass
                            yield f"data: {json.dumps({'status': 'completed', 'progress': 100, 'message': 'Download completed!'})}\n\n"
                        else:
                            # No audio in video, return video-only
                            final_file_path = video_path
                            yield f"data: {json.dumps({'status': 'completed', 'progress': 100, 'message': 'Download completed!'})}\n\n"
                    except Exception as probe_error:
                        logger.error(f"Audio probe failed: {probe_error}")
                        # Return video-only as last resort
                        final_file_path = video_path
                        yield f"data: {json.dumps({'status': 'completed', 'progress': 100, 'message': 'Download completed!'})}\n\n"
                else:
                    # Audio downloaded successfully, proceed with merge
                    audio_candidates = [f for f in os.listdir(DOWNLOAD_FOLDER) if f"audio_{session_id}" in f]
                    if not audio_candidates:
                        # This shouldn't happen if audio_downloaded is True, but handle it
                        final_file_path = video_path
                        yield f"data: {json.dumps({'status': 'completed', 'progress': 100, 'message': 'Download completed!'})}\n\n"
                    else:
                        audio_file = max(audio_candidates, key=lambda f: os.path.getctime(os.path.join(DOWNLOAD_FOLDER, f)))
                        audio_path = os.path.join(DOWNLOAD_FOLDER, audio_file)
                        
                        # Validate audio file
                        if not validate_downloaded_file(audio_path, 0.01):
                            logger.warning("Audio file validation failed, using video-only")
                            final_file_path = video_path
                            yield f"data: {json.dumps({'status': 'completed', 'progress': 100, 'message': 'Download completed!'})}\n\n"
                        else:
                            yield f"data: {json.dumps({'status': 'merging', 'phase': 'merge', 'progress': 90, 'message': 'Merging video and audio...'})}\n\n"

                            merged_p = os.path.join(DOWNLOAD_FOLDER, f"{safe_title}_{session_id}.mp4")

                            if merge_video_audio(video_path, audio_path, merged_p):
                                try: os.remove(video_path)
                                except: pass
                                try: os.remove(audio_path)
                                except: pass
                                final_file_path = merged_p
                                yield f"data: {json.dumps({'status': 'completed', 'progress': 100, 'message': 'Download completed!'})}\n\n"
                            else:
                                logger.error("Merge failed, returning video-only")
                                try: os.remove(audio_path)
                                except: pass
                                final_file_path = video_path
                                yield f"data: {json.dumps({'status': 'completed', 'progress': 100, 'message': 'Download completed!'})}\n\n"

            # Stop progress tracking
            progress_data['should_stop'] = True
            
            # Check if cancelled
            if active_downloads.get(session_id, {}).get('cancelled'):
                yield f"data: {json.dumps({'status': 'cancelled', 'message': 'Download cancelled'})}\n\n"
                yield "data: [DONE]\n\n"
                return
            
            if final_file_path:
                final_filename = os.path.basename(final_file_path).replace(f"_{session_id}", "")
                yield f"data: {json.dumps({'status': 'ready', 'session_id': session_id, 'filename': final_filename, 'message': 'Ready for download!'})}\n\n"
                yield "data: [DONE]\n\n"
            else:
                yield f"data: {json.dumps({'status': 'error', 'message': 'Download failed.'})}\n\n"
                yield "data: [DONE]\n\n"
                
        except Exception as e:
            progress_data['should_stop'] = True
            
            # Check if it was a cancellation
            if "cancelled" in str(e).lower() or active_downloads.get(session_id, {}).get('cancelled'):
                yield f"data: {json.dumps({'status': 'cancelled', 'message': 'Download cancelled'})}\n\n"
            else:
                print(f"Download Error: {e}")
                yield f"data: {json.dumps({'status': 'error', 'message': f'An unexpected error occurred: {e}'})}\n\n"
        finally:
            # Clean up tracking
            if session_id in active_downloads:
                del active_downloads[session_id]
    
    return Response(generate(), mimetype='text/event-stream')

@app.route('/download_file')
def download_file():
    """Serves the downloaded file and cleans up."""
    session_id = request.args.get('session_id')
    filename = request.args.get('filename')
    
    if not all([session_id, filename]):
        return "Missing parameters", 400
    
    # Find the file with session_id
    candidates = [
        f for f in os.listdir(DOWNLOAD_FOLDER)
        if session_id in f
    ]
    
    if not candidates:
        return "File not found", 404
        
    actual_file = max(candidates, key=lambda f: os.path.getctime(os.path.join(DOWNLOAD_FOLDER, f)))
    
    response = send_from_directory(
        DOWNLOAD_FOLDER,
        actual_file,
        as_attachment=True,
        download_name=filename
    )
    
    @response.call_on_close
    def cleanup():
        def delayed_cleanup():
            time.sleep(5)
            try:
                os.remove(os.path.join(DOWNLOAD_FOLDER, actual_file))
            except Exception as e:
                print(f"Cleanup error: {e}")
        threading.Thread(target=delayed_cleanup, daemon=True).start()
    
    return response

@app.route('/download')
def download():
    """Handles the file download process for a single video format."""
    url = request.args.get('url')
    format_id = request.args.get('format_id')
    title = request.args.get('title')
    file_type = request.args.get('type')
    best_audio_id = request.args.get('best_audio_id')

    if not all([url, format_id, title, file_type]):
        return "Missing required parameters", 400

    safe_title = sanitize_filename(title)
    session_id = str(uuid.uuid4())

    try:
        final_file_path = None

        # fallback selector (auto-pick if user format fails)
        fallback_selector = "bv*+ba/b"

        if file_type != 'video_only':
            outtmpl = os.path.join(DOWNLOAD_FOLDER, f"{safe_title}_{session_id}.%(ext)s")
            ydl_opts = {
                'format': f"{format_id}/{fallback_selector}",
                'outtmpl': outtmpl,
                'merge_output_format': 'mp4',
                'http_headers': {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            }
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([url])

            candidates = [
                os.path.join(DOWNLOAD_FOLDER, f)
                for f in os.listdir(DOWNLOAD_FOLDER)
                if session_id in f
            ]
            if not candidates:
                return "Download failed (no output file).", 500
            final_file_path = max(candidates, key=os.path.getctime)

        else:
            # --- VIDEO ONLY (download video + audio separately and merge) ---
            video_out = os.path.join(DOWNLOAD_FOLDER, f"{safe_title}_video_{session_id}.%(ext)s")
            with yt_dlp.YoutubeDL({
                'format': f"{format_id}/{fallback_selector}",
                'outtmpl': video_out,
                'http_headers': {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            }) as ydl:
                ydl.download([url])

            video_candidates = [f for f in os.listdir(DOWNLOAD_FOLDER) if f"video_{session_id}" in f]
            if not video_candidates:
                return "Video download failed.", 500
            video_file = max(video_candidates, key=lambda f: os.path.getctime(os.path.join(DOWNLOAD_FOLDER, f)))

            # Download best audio with robust error handling
            if not best_audio_id:
                info = get_video_info(url)
                if info:
                    best_audio_id = get_best_audio_format(info)
            
            if not best_audio_id:
                logger.warning("No audio format available, checking if video has embedded audio")
                # Check if video file has embedded audio
                video_p = os.path.join(DOWNLOAD_FOLDER, video_file)
                try:
                    probe_cmd = ['ffprobe', '-v', 'quiet', '-show_streams', '-select_streams', 'a', video_p]
                    result = subprocess.run(probe_cmd, capture_output=True, text=True)
                    
                    if result.returncode == 0 and result.stdout.strip():
                        # Video has audio, use it directly
                        final_file_path = video_p
                        logger.info("Using video file with embedded audio")
                    else:
                        return "No audio available for this video.", 400
                except Exception as e:
                    logger.error(f"Audio probe failed: {e}")
                    return "No audio format available to merge.", 500
            else:
                # Try to download audio
                audio_out = os.path.join(DOWNLOAD_FOLDER, f"{safe_title}_audio_{session_id}.%(ext)s")
                try:
                    with yt_dlp.YoutubeDL({
                        'format': f"{best_audio_id}/{fallback_selector}",
                        'outtmpl': audio_out,
                        'ignoreerrors': False,
                        'http_headers': {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                        }
                    }) as ydl:
                        ydl.download([url])
                except Exception as e:
                    logger.error(f"Audio download failed: {e}")
                    # Fallback to video-only
                    video_p = os.path.join(DOWNLOAD_FOLDER, video_file)
                    final_file_path = video_p
                    logger.info("Falling back to video-only due to audio download failure")
                else:
                    audio_candidates = [f for f in os.listdir(DOWNLOAD_FOLDER) if f"audio_{session_id}" in f]
                    if not audio_candidates:
                        logger.warning("Audio download completed but no file found")
                        video_p = os.path.join(DOWNLOAD_FOLDER, video_file)
                        final_file_path = video_p
                    else:
                        audio_file = max(audio_candidates, key=lambda f: os.path.getctime(os.path.join(DOWNLOAD_FOLDER, f)))
                        video_p = os.path.join(DOWNLOAD_FOLDER, video_file)
                        audio_p = os.path.join(DOWNLOAD_FOLDER, audio_file)
                        
                        # Validate both files before merge
                        if not validate_downloaded_file(video_p, 0.01) or not validate_downloaded_file(audio_p, 0.01):
                            logger.error("Downloaded files validation failed")
                            final_file_path = video_p
                        
                        merged_p = os.path.join(DOWNLOAD_FOLDER, f"{safe_title}_{session_id}.mp4")

                        if merge_video_audio(video_p, audio_p, merged_p):
                            try: os.remove(video_p)
                            except: pass
                            try: os.remove(audio_p)
                            except: pass
                            final_file_path = merged_p
                            logger.info("Successfully merged video and audio")
                        else:
                            logger.error(f"Failed to merge {video_p} and {audio_p}, using video-only")
                            try: os.remove(audio_p)
                            except: pass
                            final_file_path = video_p

        if not final_file_path:
            return "Download failed.", 500

        final_filename = os.path.basename(final_file_path).replace(f"_{session_id}", "")
        response = send_from_directory(
            DOWNLOAD_FOLDER,
            os.path.basename(final_file_path),
            as_attachment=True,
            download_name=final_filename
        )

        @response.call_on_close
        def cleanup():
            def delayed_cleanup():
                time.sleep(5)
                try:
                    os.remove(final_file_path)
                except Exception as e:
                    print(f"Cleanup error: {e}")
            threading.Thread(target=delayed_cleanup, daemon=True).start()

        return response

    except Exception as e:
        print(f"Download Error: {e}")
        return f'An unexpected error occurred: {e}', 500

@app.route('/stream_playlist_download')
def stream_playlist_download():
    """Handles the entire playlist download process with progress and zipping."""
    url = request.args.get('url')
    quality = request.args.get('quality', '1080')
    start_index = int(request.args.get('start', 1)) - 1
    end_index = int(request.args.get('end', 9999))
    
    if not url: 
        return Response("Missing URL parameter.", status=400)

    def generate():
        nonlocal url, quality, start_index, end_index  # Make variables accessible
        playlist_info = get_video_info(url)  # Get full info now
        if not playlist_info or 'entries' not in playlist_info:
            yield f"data: {json.dumps({'status': 'error', 'message': 'Could not fetch full playlist info.'})}\n\n"
            return

        session_id = str(uuid.uuid4())
        playlist_title = sanitize_filename(playlist_info.get('title', 'playlist'))
        playlist_dir = os.path.join(DOWNLOAD_FOLDER, f"{playlist_title}_{session_id}")
        os.makedirs(playlist_dir, exist_ok=True)
        
        format_selector = f'bestvideo[height<={quality}]+bestaudio/best[height<={quality}]/best'

        entries = [e for e in playlist_info.get('entries', []) if e]
        
        # Fix end_index to be inclusive and within bounds
        actual_end_index = min(end_index, len(entries))
        videos_to_download = entries[start_index:actual_end_index]
        total_videos = len(videos_to_download)
        
        if total_videos == 0:
            yield f"data: {json.dumps({'status': 'error', 'message': 'No videos found in the specified range.'})}\n\n"
            return
        
        yield f"data: {json.dumps({'status': 'starting', 'total_videos': total_videos, 'message': f'Starting download of {total_videos} videos...'})}\n\n"

        completed_videos = []
        current_video_index = 0
        current_video_title = ""
        download_start_time = time.time()
        total_downloaded_bytes = 0
        
        # Progress tracking variables
        progress_queue = queue.Queue()
        current_progress = {'should_stop': False}
        
        def progress_hook(d):
            nonlocal current_video_index, current_video_title, total_downloaded_bytes
            
            if d.get('status') == 'downloading':
                downloaded = d.get('downloaded_bytes', 0)
                total = d.get('total_bytes') or d.get('total_bytes_estimate', 0)
                speed = d.get('speed', 0)
                eta = d.get('eta', 0)
                
                if total > 0:
                    percent = (downloaded / total) * 100
                    speed_str = f"{speed / 1024 / 1024:.1f} MB/s" if speed else "0 MB/s"
                    size_str = f"{downloaded / 1024 / 1024:.1f} MB / {total / 1024 / 1024:.1f} MB"
                    
                    if eta:
                        eta_mins = int(eta // 60)
                        eta_secs = int(eta % 60)
                        eta_str = f"{eta_mins:02d}:{eta_secs:02d}"
                    else:
                        eta_str = "N/A"
                    
                    # Calculate overall progress
                    video_progress = (current_video_index / total_videos) * 100
                    current_video_progress = (percent / 100) * (100 / total_videos)
                    overall_progress = video_progress + current_video_progress
                    
                    # Store progress data in queue for real-time updates
                    progress_data = {
                        'status': 'downloading',
                        'current_video': current_video_index + 1,
                        'total_videos': total_videos,
                        'video_title': current_video_title,
                        'phase': 'Downloading',
                        'progress': overall_progress,
                        'speed': speed_str,
                        'size': size_str,
                        'eta': eta_str,
                        'message': f'Downloading video {current_video_index + 1}/{total_videos}: {percent:.1f}%'
                    }
                    try:
                        progress_queue.put_nowait(progress_data)
                    except queue.Full:
                        pass
                    
            elif d.get('status') == 'finished' and d.get('info_dict'):
                video_title = d['info_dict'].get('title', 'Untitled Video')
                if video_title not in completed_videos:
                    completed_videos.append(video_title)
                    current_video_index += 1
                    logger.info(f"Downloaded {current_video_index}/{total_videos}: {video_title}")

        ydl_opts = {
            'format': format_selector,
            'outtmpl': os.path.join(playlist_dir, '%(title)s.%(ext)s'),
            'postprocessors': [{'key': 'FFmpegVideoConvertor', 'preferedformat': 'mp4'}],
            'progress_hooks': [progress_hook],
            'ignoreerrors': True,
            'http_headers': {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        }
        
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                urls_to_download = [video.get('webpage_url') or video.get('url') for video in videos_to_download]
                
                # Download videos one by one to track progress better
                for i, video_url in enumerate(urls_to_download, 1):
                    try:
                        # Get video info for title
                        video_info = videos_to_download[i-1]
                        current_video_title = video_info.get('title', f'Video {i}')
                        current_video_index = i - 1
                        
                        # Send start update
                        start_data = {
                            'status': 'downloading',
                            'current_video': i,
                            'total_videos': total_videos,
                            'video_title': current_video_title,
                            'phase': 'Starting',
                            'progress': 0,
                            'speed': '0 MB/s',
                            'size': '0 MB / 0 MB',
                            'eta': 'N/A',
                            'message': f'Starting video {i}/{total_videos}: {current_video_title[:50]}...'
                        }
                        yield f"data: {json.dumps(start_data)}\n\n"
                        
                        # Validate video URL
                        if not video_url or not video_url.startswith(('http://', 'https://')):
                            logger.warning(f"Skipping invalid URL: {video_url}")
                            continue
                        
                        # Download in separate thread to allow real-time progress
                        def download_video():
                            try:
                                ydl.download([video_url])
                            except Exception as e:
                                logger.error(f"Download error for video {i}: {e}")
                        
                        download_thread = threading.Thread(target=download_video)
                        download_thread.start()
                        
                        # Send real-time progress updates while downloading
                        while download_thread.is_alive():
                            try:
                                progress_data = progress_queue.get_nowait()
                                yield f"data: {json.dumps(progress_data)}\n\n"
                            except queue.Empty:
                                pass
                            time.sleep(0.3)
                        
                        download_thread.join()
                        
                        # Send any remaining progress updates
                        while not progress_queue.empty():
                            try:
                                progress_data = progress_queue.get_nowait()
                                yield f"data: {json.dumps(progress_data)}\n\n"
                            except queue.Empty:
                                break
                        
                        # Send completion update with correct overall progress
                        overall_progress = (i / total_videos) * 100
                        completion_data = {
                            'status': 'downloading',
                            'current_video': i,
                            'total_videos': total_videos,
                            'video_title': current_video_title,
                            'phase': 'Completed',
                            'progress': overall_progress,
                            'speed': '0 MB/s',
                            'size': 'Complete',
                            'eta': '00:00',
                            'message': f'Completed video {i}/{total_videos}'
                        }
                        yield f"data: {json.dumps(completion_data)}\n\n"
                        
                    except Exception as video_error:
                        logger.error(f"Error downloading video {i}: {video_error}")
                        # Send error update but continue
                        error_data = {
                            'status': 'downloading',
                            'current_video': i,
                            'total_videos': total_videos,
                            'video_title': current_video_title,
                            'phase': 'Error',
                            'progress': 0,
                            'speed': '0 MB/s',
                            'size': 'Failed',
                            'eta': 'N/A',
                            'message': f'Failed video {i}, continuing...'
                        }
                        yield f"data: {json.dumps(error_data)}\n\n"
                        continue

            # Send zipping status
            zip_data = {
                'status': 'zipping',
                'current_video': total_videos,
                'total_videos': total_videos,
                'video_title': 'All Videos',
                'phase': 'Zipping',
                'progress': 95,
                'speed': '0 MB/s',
                'size': 'Creating ZIP',
                'eta': 'N/A',
                'message': 'Creating ZIP file...'
            }
            yield f"data: {json.dumps(zip_data)}\n\n"
            
            zip_filename = f"{playlist_title}.zip"
            unique_zip_name = f"{playlist_title}_{session_id}.zip"
            zip_filepath = os.path.join(DOWNLOAD_FOLDER, unique_zip_name)
            
            with zipfile.ZipFile(zip_filepath, 'w', zipfile.ZIP_DEFLATED) as zipf:
                for root, _, files in os.walk(playlist_dir):
                    for file in files: zipf.write(os.path.join(root, file), arcname=file)
            
            final_data = {'status': 'finished', 'zip_name': zip_filename, 'session_id': session_id}
            yield f"data: {json.dumps(final_data)}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            print(f"Playlist Stream Error: {e}")
            import traceback
            traceback.print_exc()
            yield f"data: {json.dumps({'status': 'error', 'message': f'Download failed: {str(e)}'})}\n\n"
            
    return Response(generate(), mimetype='text/event-stream')

@app.route('/download_zip')
def download_zip():
    """Serves the final ZIP and cleans up all temporary files."""
    session_id = request.args.get('session_id'); zip_name = request.args.get('zip_name')
    if not all([session_id, zip_name]): return "Missing parameters", 400

    playlist_title = sanitize_filename(zip_name.replace('.zip', ''))
    unique_zip_name = f"{playlist_title}_{session_id}.zip"
    temp_dir_name = f"{playlist_title}_{session_id}"

    response = send_from_directory(DOWNLOAD_FOLDER, unique_zip_name, as_attachment=True, download_name=zip_name)

    @response.call_on_close
    def cleanup():
        def delayed_cleanup():
            time.sleep(5)
            try:
                zip_path = os.path.join(DOWNLOAD_FOLDER, unique_zip_name)
                dir_path = os.path.join(DOWNLOAD_FOLDER, temp_dir_name)
                if os.path.exists(zip_path): os.remove(zip_path)
                if os.path.exists(dir_path): shutil.rmtree(dir_path)
            except Exception as e:
                print(f"Cleanup error: {e}")
        threading.Thread(target=delayed_cleanup, daemon=True).start()
    return response

# ============================================================================== 
# RUN APPLICATION
# ============================================================================== 
if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=8000)