document.addEventListener('DOMContentLoaded', () => {
    const App = {
        // --- Element Cache ---
        els: {
            themeDropdown: document.getElementById('themeDropdown'),
            videoForm: document.getElementById('videoForm'),
            videoURLInput: document.getElementById('videoURL'),
            fetchBtn: document.getElementById('fetchBtn'),
            fetchBtnSpinner: document.getElementById('fetchBtnSpinner'),
            fetchBtnText: document.getElementById('fetchBtnText'),
            resultsSection: document.getElementById('resultsSection'),
            loadingSkeleton: document.getElementById('loadingSkeleton'),
            contentWrapper: document.getElementById('contentWrapper'),
            toastContainer: document.querySelector('.toast-container'),
            singleVideoResult: document.getElementById('singleVideoResult'),
            playlistResult: document.getElementById('playlistResult'),
            videoPlayerModal: document.getElementById('videoPlayerModal'),
            videoPlayerIframe: document.getElementById('videoPlayerIframe'),
            singleProgressModal: document.getElementById('singleProgressModal'),
            audioProgressModal: document.getElementById('audioProgressModal'),
            singleProgressPhase: document.getElementById('singleProgressPhase'),
            singleProgressPercent: document.getElementById('singleProgressPercent'),
            singleProgressSpeed: document.getElementById('singleProgressSpeed'),
            singleProgressSize: document.getElementById('singleProgressSize'),
            singleProgressEta: document.getElementById('singleProgressEta'),
            singleProgressStatus: document.getElementById('singleProgressStatus'),
            stepVideo: document.getElementById('stepVideo'),
            stepAudio: document.getElementById('stepAudio'),
            stepMerge: document.getElementById('stepMerge'),
            stepAudioContainer: document.getElementById('stepAudioContainer'),
            stepMergeContainer: document.getElementById('stepMergeContainer'),
            cancelSingleDownloadBtn: document.getElementById('cancelSingleDownloadBtn'),
            progressModal: document.getElementById('progressModal'),
            progressStatusText: document.getElementById('progressStatusText'),
            progressBar: document.getElementById('progressBar'),
            progressLog: document.getElementById('progressLog'),
            cancelDownloadBtn: document.getElementById('cancelDownloadBtn'),
            historyTableBody: document.getElementById('historyTableBody'),
            clearHistoryBtn: document.getElementById('clearHistoryBtn'),
        },

        // --- State ---
        state: {
            lastVideoData: null,
            lastPlaylistData: null,
            videoPlayerModalInstance: null,
            singleProgressModalInstance: null,
            audioProgressModalInstance: null,
            progressModalInstance: null,
            sseConnection: null,
            singleSseConnection: null,
            currentSessionId: null,
        },

        // --- Initialize ---
        init() {
            console.log('App initializing...');
            this.initTheme();
            this.initModals();
            this.initPages();
        },

        initTheme() {
            const getStoredTheme = () => localStorage.getItem('theme');
            const setStoredTheme = (theme) => localStorage.setItem('theme', theme);

            const setAndApplyTheme = (theme) => {
                setStoredTheme(theme);
                const effectiveTheme = theme === 'auto' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme;
                document.documentElement.setAttribute('data-bs-theme', effectiveTheme);

                if (this.els.themeDropdown) {
                    const themeIcon = this.els.themeDropdown.querySelector('i.bi');
                    if (themeIcon) {
                        this.els.themeDropdown.parentElement.querySelectorAll('.dropdown-item').forEach(item => item.classList.remove('active'));
                        const activeItem = this.els.themeDropdown.parentElement.querySelector(`[data-theme-value="${theme}"]`);
                        if (activeItem) activeItem.classList.add('active');

                        if (theme === 'dark') themeIcon.className = 'bi bi-moon-stars-fill fs-5';
                        else if (theme === 'light') themeIcon.className = 'bi bi-sun-fill fs-5';
                        else themeIcon.className = 'bi bi-circle-half fs-5';
                    }
                }
            };

            if (this.els.themeDropdown) {
                this.els.themeDropdown.parentElement.querySelectorAll('.dropdown-item').forEach(item => {
                    item.addEventListener('click', (e) => {
                        e.preventDefault();
                        setAndApplyTheme(e.currentTarget.dataset.themeValue);
                    });
                });
            }

            window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
                if (getStoredTheme() === 'auto') setAndApplyTheme('auto');
            });

            setAndApplyTheme(getStoredTheme() || 'auto');
        },

        initModals() {
            if (this.els.videoPlayerModal) {
                this.state.videoPlayerModalInstance = new bootstrap.Modal(this.els.videoPlayerModal);
                this.els.videoPlayerModal.addEventListener('hidden.bs.modal', () => {
                    if (this.els.videoPlayerIframe) this.els.videoPlayerIframe.src = 'about:blank';
                });
            }
            if (this.els.singleProgressModal) {
                this.state.singleProgressModalInstance = new bootstrap.Modal(this.els.singleProgressModal);
            }
            if (this.els.audioProgressModal) {
                this.state.audioProgressModalInstance = new bootstrap.Modal(this.els.audioProgressModal);
            }
            if (this.els.progressModal) {
                this.state.progressModalInstance = new bootstrap.Modal(this.els.progressModal);
            }
            
            // Add event listeners for cancel buttons
            document.addEventListener('click', (e) => {
                if (e.target.closest('#cancelSingleDownloadBtn')) {
                    e.preventDefault();
                    this.closeSingleSseConnection();
                }
                if (e.target.closest('#cancelAudioDownloadBtn')) {
                    e.preventDefault();
                    this.closeSingleSseConnection();
                }
                if (e.target.closest('#cancelDownloadBtn')) {
                    e.preventDefault();
                    this.cancelPlaylistDownload();
                }
            });
            
            // Handle window resize for responsive progress ring
            window.addEventListener('resize', () => {
                this.updateProgressRingResponsive();
            });
        },

        updateProgressRingResponsive() {
            const progressRing = document.getElementById('progressRing');
            const progressSvg = document.querySelector('.progress-ring');
            
            if (progressRing && progressSvg && this.state.singleProgressModalInstance) {
                const circumference = this.getProgressRingCircumference();
                progressRing.style.strokeDasharray = circumference;
                
                // Update SVG attributes based on screen size
                if (window.innerWidth <= 576) {
                    progressSvg.setAttribute('viewBox', '0 0 80 80');
                    progressRing.setAttribute('cx', '40');
                    progressRing.setAttribute('cy', '40');
                    progressRing.setAttribute('r', '32');
                    progressRing.setAttribute('transform', 'rotate(-90 40 40)');
                    progressRing.previousElementSibling.setAttribute('cx', '40');
                    progressRing.previousElementSibling.setAttribute('cy', '40');
                    progressRing.previousElementSibling.setAttribute('r', '32');
                } else if (window.innerWidth <= 768) {
                    progressSvg.setAttribute('viewBox', '0 0 100 100');
                    progressRing.setAttribute('cx', '50');
                    progressRing.setAttribute('cy', '50');
                    progressRing.setAttribute('r', '40');
                    progressRing.setAttribute('transform', 'rotate(-90 50 50)');
                    progressRing.previousElementSibling.setAttribute('cx', '50');
                    progressRing.previousElementSibling.setAttribute('cy', '50');
                    progressRing.previousElementSibling.setAttribute('r', '40');
                } else {
                    progressSvg.setAttribute('viewBox', '0 0 120 120');
                    progressRing.setAttribute('cx', '60');
                    progressRing.setAttribute('cy', '60');
                    progressRing.setAttribute('r', '50');
                    progressRing.setAttribute('transform', 'rotate(-90 60 60)');
                    progressRing.previousElementSibling.setAttribute('cx', '60');
                    progressRing.previousElementSibling.setAttribute('cy', '60');
                    progressRing.previousElementSibling.setAttribute('r', '50');
                }
                
                // Maintain current progress if modal is open
                const currentPercent = this.els.singleProgressPercent ? 
                    parseInt(this.els.singleProgressPercent.textContent) || 0 : 0;
                const offset = circumference - (currentPercent / 100) * circumference;
                progressRing.style.strokeDashoffset = offset;
            }
        },

        initPages() {
            if (this.els.videoForm) this.initHomePage();
            if (this.els.historyTableBody) this.initHistoryPage();
        },

        initHomePage() {
            console.log('Initializing home page...');
            this.els.videoForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                console.log('Form submitted');
                
                const url = this.els.videoURLInput.value.trim();
                if (!url) return;
                
                this.showLoadingState(true);
                
                try {
                    const res = await fetch('/api/fetch_info', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ url })
                    });
                    
                    this.showLoadingState(false);
                    
                    if (!res.ok) {
                        this.showToast('Failed to fetch info. The URL may be invalid or unsupported.', 'danger');
                        return;
                    }
                    
                    const data = await res.json();
                    if (data.error) {
                        this.showToast(data.error, 'danger');
                        return;
                    }

                    if (data.type === 'playlist') {
                        this.state.lastPlaylistData = data;
                        this.displayPlaylistInfo(data);
                    } else {
                        this.state.lastVideoData = data;
                        this.displaySingleVideoInfo(data);
                    }
                } catch (error) {
                    console.error('Fetch error:', error);
                    this.showLoadingState(false);
                    this.showToast('Network error occurred.', 'danger');
                }
            });

            // Event delegation for dynamic buttons
            document.body.addEventListener('click', (e) => {
                const btn = e.target.closest('.download-btn');
                const playBtn = e.target.closest('.play-icon-overlay, .thumbnail-container');
                const shareBtn = e.target.closest('#shareLink');
                
                if (btn) {
                    e.preventDefault();
                    this.handleSingleVideoDownload(btn);
                }
                
                if (playBtn) {
                    e.preventDefault();
                    this.openVideoPlayer();
                }
                
                if (shareBtn) {
                    e.preventDefault();
                    this.shareVideo();
                }
            });
            
            // Check for redownload URL and auto-fetch
            const redownloadUrl = localStorage.getItem('redownloadUrl');
            if (redownloadUrl) {
                this.els.videoURLInput.value = redownloadUrl;
                localStorage.removeItem('redownloadUrl');
                // Auto-submit the form
                setTimeout(() => {
                    if (this.els.fetchBtn) this.els.fetchBtn.click();
                }, 100);
            }
        },

        initHistoryPage() {
            if (!this.els.historyTableBody) return;
            this.loadHistory();
            
            // Event delegation for history page buttons
            document.addEventListener('click', (e) => {
                const deleteBtn = e.target.closest('.delete-history-btn');
                const redownloadBtn = e.target.closest('.redownload-btn');
                const clearBtn = e.target.closest('#clearHistoryBtn');
                
                if (deleteBtn) {
                    e.preventDefault();
                    const index = parseInt(deleteBtn.dataset.index, 10);
                    this.deleteHistoryItem(index);
                    this.loadHistory();
                    this.showToast('Item removed from history.', 'success');
                }
                
                if (redownloadBtn) {
                    e.preventDefault();
                    localStorage.setItem('redownloadUrl', redownloadBtn.dataset.url);
                    window.location.href = '/';
                }
                
                if (clearBtn) {
                    e.preventDefault();
                    if (confirm('Are you sure you want to clear your entire download history?')) {
                        this.clearHistory();
                        this.loadHistory();
                        this.showToast('History cleared.', 'success');
                    }
                }
            });
        },

        showLoadingState(isLoading) {
            if (!this.els.fetchBtn) return;
            
            this.els.fetchBtn.disabled = isLoading;
            if (this.els.fetchBtnSpinner) this.els.fetchBtnSpinner.classList.toggle('d-none', !isLoading);
            if (this.els.fetchBtnText) this.els.fetchBtnText.textContent = isLoading ? 'Fetching...' : 'Fetch';
            
            if (isLoading && this.els.resultsSection) {
                this.els.resultsSection.classList.remove('d-none');
                if (this.els.contentWrapper) this.els.contentWrapper.classList.add('d-none');
                if (this.els.loadingSkeleton) this.els.loadingSkeleton.classList.remove('d-none');
            } else {
                if (this.els.loadingSkeleton) this.els.loadingSkeleton.classList.add('d-none');
            }
        },

        displaySingleVideoInfo(data) {
            console.log('Displaying single video info:', data);
            
            const elements = {
                videoTitle: document.getElementById('videoTitle'),
                openVideo: document.getElementById('openVideo'),
                videoDate: document.getElementById('videoDate'),
                videoDuration: document.getElementById('videoDuration'),
                videoLikes: document.getElementById('videoLikes'),
                videoThumbnail: document.getElementById('videoThumbnail'),
                videoPlatform: document.getElementById('videoPlatform'),
                openAuthor: document.getElementById('openAuthor')
            };

            if (elements.videoTitle) elements.videoTitle.textContent = data.title;
            if (elements.openVideo) elements.openVideo.href = data.original_url || '#';
            if (elements.videoDate) elements.videoDate.textContent = data.upload_date;
            if (elements.videoDuration) elements.videoDuration.textContent = data.duration;
            if (elements.videoLikes) elements.videoLikes.textContent = data.like_count;
            if (elements.videoThumbnail) elements.videoThumbnail.src = data.thumbnail || 'static/placeholder.png';
            
            if (elements.videoPlatform) {
                const platform = data.platform.charAt(0).toUpperCase() + data.platform.slice(1);
                elements.videoPlatform.innerHTML = `<i class="bi bi-${this.getPlatformIcon(data.platform)}"></i> ${platform}`;
            }
            
            if (elements.openAuthor) {
                if (data.author_url) {
                    elements.openAuthor.href = data.author_url;
                    elements.openAuthor.classList.remove('disabled');
                } else {
                    elements.openAuthor.href = '#';
                    elements.openAuthor.classList.add('disabled');
                }
            }

            this.populateFormats(data.video_formats, data.audio_formats);

            if (this.els.playlistResult) this.els.playlistResult.classList.add('d-none');
            if (this.els.singleVideoResult) this.els.singleVideoResult.classList.remove('d-none');
            if (this.els.contentWrapper) this.els.contentWrapper.classList.remove('d-none');
        },

        populateFormats(videoFormats, audioFormats) {
            const videoTable = document.getElementById('videoFormats');
            const audioTable = document.getElementById('audioFormats');
            
            if (videoTable) {
                videoTable.innerHTML = '';
                videoFormats.forEach(vf => {
                    const row = `<tr>
                        <td>${vf.resolution}</td>
                        <td>${vf.filesize}</td>
                        <td><span class="badge bg-secondary">${vf.type.replace('_', ' ')}</span></td>
                        <td><button class="btn btn-sm btn-success download-btn" data-type="${vf.type}" data-format="${vf.format_id}">
                            <i class="bi bi-download"></i>
                        </button></td>
                    </tr>`;
                    videoTable.innerHTML += row;
                });
            }
            
            if (audioTable) {
                audioTable.innerHTML = '';
                audioFormats.forEach(af => {
                    const row = `<tr>
                        <td>${af.quality}</td>
                        <td>${af.filesize}</td>
                        <td><button class="btn btn-sm btn-success download-btn" data-type="audio" data-format="${af.format_id}">
                            <i class="bi bi-download"></i>
                        </button></td>
                    </tr>`;
                    audioTable.innerHTML += row;
                });
            }
        },

        displayPlaylistInfo(data) {
            console.log('Displaying playlist info:', data);
            
            const elements = {
                playlistTitle: document.getElementById('playlistTitle'),
                playlistThumbnail: document.getElementById('playlistThumbnail'),
                playlistMeta: document.getElementById('playlistMeta'),
                openPlaylist: document.getElementById('openPlaylist'),
                openPlaylistAuthor: document.getElementById('openPlaylistAuthor'),
                playlistVideos: document.getElementById('playlistVideos')
            };

            if (elements.playlistTitle) elements.playlistTitle.textContent = data.title;
            if (elements.playlistThumbnail) {
                elements.playlistThumbnail.src = data.thumbnail || 'static/placeholder.png';
            }
            if (elements.playlistMeta) {
                const totalDuration = this.calculateTotalDuration(data.videos);
                elements.playlistMeta.innerHTML = `
                    <div class="d-flex flex-wrap gap-3 text-muted small">
                        <span><i class="bi bi-collection-play me-1"></i> ${data.video_count} videos</span>
                        <span><i class="bi bi-person-video me-1"></i> ${data.author}</span>
                        ${totalDuration ? `<span><i class="bi bi-clock me-1"></i> ${totalDuration}</span>` : ''}
                    </div>
                `;
            }
            if (elements.openPlaylist) {
                elements.openPlaylist.href = data.original_url || '#';
            }
            if (elements.openPlaylistAuthor) {
                elements.openPlaylistAuthor.href = '#';
                elements.openPlaylistAuthor.classList.add('disabled');
            }

            // Populate playlist videos table
            if (elements.playlistVideos && data.videos) {
                elements.playlistVideos.innerHTML = '';
                data.videos.forEach((video, index) => {
                    const safeTitle = video.title ? video.title.replace(/"/g, '&quot;') : 'Untitled Video';
                    const duration = video.duration || 'N/A';
                    
                    const row = `<tr class="playlist-video-row" data-video-index="${index}">
                        <td><span class="badge bg-primary">${index + 1}</span></td>
                        <td>
                            <div class="position-relative">
                                <div class="bg-secondary rounded d-flex align-items-center justify-content-center" style="width: 80px; height: 45px;">
                                    <i class="bi bi-play-fill text-white fs-5"></i>
                                </div>
                                <div class="position-absolute bottom-0 end-0 bg-dark text-white px-1 rounded" style="font-size: 0.7rem;">
                                    ${duration}
                                </div>
                            </div>
                        </td>
                        <td>
                            <div class="text-truncate" style="max-width: 400px;" title="${safeTitle}">
                                <strong>${safeTitle}</strong>
                            </div>
                        </td>
                        <td>
                            <span class="text-muted">${duration}</span>
                        </td>
                    </tr>`;
                    elements.playlistVideos.innerHTML += row;
                });
                
                // Add hover effects
                const rows = elements.playlistVideos.querySelectorAll('.playlist-video-row');
                rows.forEach(row => {
                    row.style.cursor = 'pointer';
                    row.addEventListener('mouseenter', () => {
                        row.style.backgroundColor = 'var(--bs-secondary-bg)';
                    });
                    row.addEventListener('mouseleave', () => {
                        row.style.backgroundColor = '';
                    });
                });
            }

            // Setup playlist download event listeners
            this.setupPlaylistDownloadListeners(data);

            if (this.els.singleVideoResult) this.els.singleVideoResult.classList.add('d-none');
            if (this.els.playlistResult) this.els.playlistResult.classList.remove('d-none');
            if (this.els.contentWrapper) this.els.contentWrapper.classList.remove('d-none');
        },

        handleSingleVideoDownload(btn) {
            const formatId = btn.dataset.format;
            const type = btn.dataset.type;
            
            if (!this.state.lastVideoData) return;
            
            if (this.state.singleSseConnection) {
                this.showToast('A download is already in progress.', 'warning');
                return;
            }
            
            this.saveToHistory(this.state.lastVideoData);
            this.startSingleVideoDownload(formatId, type);
        },

        startSingleVideoDownload(formatId, type) {
            const params = new URLSearchParams({
                url: this.state.lastVideoData.original_url,
                format_id: formatId,
                title: this.state.lastVideoData.title,
                type: type,
                best_audio_id: this.state.lastVideoData.best_audio_id || ''
            });
            
            // Use audio modal for audio downloads
            if (type === 'audio') {
                this.resetAudioProgressModal();
                if (this.state.audioProgressModalInstance) {
                    this.state.audioProgressModalInstance.show();
                }
            } else {
                this.resetSingleProgressModal(type);
                if (this.state.singleProgressModalInstance) {
                    this.state.singleProgressModalInstance.show();
                }
            }
            
            this.state.singleSseConnection = new EventSource(`/stream_single_download?${params.toString()}`);
            
            this.state.singleSseConnection.onmessage = (event) => {
                if (event.data === '[DONE]') {
                    // Close connection without showing error messages
                    if (this.state.singleSseConnection) {
                        this.state.singleSseConnection.close();
                        this.state.singleSseConnection = null;
                    }
                    this.state.currentSessionId = null;
                    return;
                }
                try {
                    const data = JSON.parse(event.data);
                    // Store session ID for cancellation
                    if (data.session_id) {
                        this.state.currentSessionId = data.session_id;
                    }
                    // Use appropriate progress handler based on download type
                    if (type === 'audio') {
                        this.updateAudioProgress(data);
                    } else {
                        this.updateSingleProgress(data);
                    }
                } catch (e) {
                    console.error('Error parsing SSE data:', e);
                }
            };
            
            this.state.singleSseConnection.onerror = () => {
                // Only show error if download wasn't completed
                if (this.state.singleSseConnection && this.state.singleSseConnection.readyState !== EventSource.CLOSED) {
                    this.showToast('Connection to server lost.', 'danger');
                }
                this.closeSingleSseConnection();
            };
        },

        resetSingleProgressModal(type) {
            if (this.els.singleProgressPhase) this.els.singleProgressPhase.textContent = 'Initializing...';
            const phaseMobile = document.getElementById('singleProgressPhaseMobile');
            if (phaseMobile) phaseMobile.textContent = 'Initializing...';
            if (this.els.singleProgressPercent) this.els.singleProgressPercent.textContent = '0%';
            
            // Add audio-specific styling
            const modalBody = document.querySelector('#singleProgressModal .modal-body');
            if (modalBody) {
                modalBody.classList.toggle('audio-progress', type === 'audio');
            }
            
            const progressRing = document.getElementById('progressRing');
            if (progressRing) {
                const circumference = this.getProgressRingCircumference();
                progressRing.style.strokeDashoffset = circumference;
            }
            
            const timelineProgress = document.getElementById('timelineProgress');
            if (timelineProgress) timelineProgress.style.width = '0%';
            
            if (this.els.singleProgressSpeed) this.els.singleProgressSpeed.textContent = 'N/A';
            if (this.els.singleProgressSize) this.els.singleProgressSize.textContent = 'N/A';
            if (this.els.singleProgressEta) this.els.singleProgressEta.textContent = 'N/A';
            if (this.els.singleProgressStatus) {
                this.els.singleProgressStatus.textContent = 'Starting';
                this.els.singleProgressStatus.className = 'stat-value text-primary';
            }
            
            // Reset step styles
            if (this.els.stepVideo) this.els.stepVideo.className = 'step-circle';
            if (this.els.stepAudio) this.els.stepAudio.className = 'step-circle';
            if (this.els.stepMerge) this.els.stepMerge.className = 'step-circle';
            
            if (type === 'video_only') {
                if (this.els.stepAudioContainer) this.els.stepAudioContainer.classList.remove('d-none');
                if (this.els.stepMergeContainer) this.els.stepMergeContainer.classList.remove('d-none');
            } else {
                if (this.els.stepAudioContainer) this.els.stepAudioContainer.classList.add('d-none');
                if (this.els.stepMergeContainer) this.els.stepMergeContainer.classList.add('d-none');
            }
        },

        resetAudioProgressModal() {
            const audioProgressPhase = document.getElementById('audioProgressPhase');
            const audioProgressPhaseMobile = document.getElementById('audioProgressPhaseMobile');
            const audioProgressPercent = document.getElementById('audioProgressPercent');
            const audioProgressSpeed = document.getElementById('audioProgressSpeed');
            const audioProgressSize = document.getElementById('audioProgressSize');
            const audioProgressEta = document.getElementById('audioProgressEta');
            const audioProgressStatus = document.getElementById('audioProgressStatus');
            
            if (audioProgressPhase) audioProgressPhase.textContent = 'Initializing...';
            if (audioProgressPhaseMobile) audioProgressPhaseMobile.textContent = 'Initializing...';
            if (audioProgressPercent) audioProgressPercent.textContent = '0%';
            
            const audioProgressRing = document.getElementById('audioProgressRing');
            if (audioProgressRing) {
                const circumference = this.getAudioProgressRingCircumference();
                audioProgressRing.style.strokeDashoffset = circumference;
            }
            
            if (audioProgressSpeed) audioProgressSpeed.textContent = 'N/A';
            if (audioProgressSize) audioProgressSize.textContent = 'N/A';
            if (audioProgressEta) audioProgressEta.textContent = 'N/A';
            if (audioProgressStatus) {
                audioProgressStatus.textContent = 'Starting';
                audioProgressStatus.className = 'fw-bold';
                audioProgressStatus.style.color = 'var(--primary-color)';
            }
        },

        getAudioProgressRingCircumference() {
            if (window.innerWidth <= 576) {
                return 226; // Mobile: 2 * π * 36
            } else if (window.innerWidth <= 768) {
                return 276; // Tablet: 2 * π * 44
            } else {
                return 314; // Desktop: 2 * π * 50
            }
        },

        getProgressRingCircumference() {
            // Calculate circumference based on screen size and download type
            const isAudio = document.querySelector('.audio-progress');
            
            if (window.innerWidth <= 576) {
                return isAudio ? 226 : 201; // Mobile: audio 2 * π * 36, video 2 * π * 32
            } else if (window.innerWidth <= 768) {
                return isAudio ? 276 : 251; // Tablet: audio 2 * π * 44, video 2 * π * 40
            } else {
                return 314; // Desktop: 2 * π * 50 (same for both)
            }
        },

        updateSingleProgress(data) {
            switch (data.status) {
                case 'starting':
                    if (this.els.singleProgressPhase) this.els.singleProgressPhase.textContent = 'Starting download...';
                    if (this.els.stepVideo) this.els.stepVideo.classList.add('active');
                    this.updateTimelineProgress(33);
                    break;
                    
                case 'downloading':
                    const progress = Math.round(data.progress || 0);
                    if (this.els.singleProgressPercent) this.els.singleProgressPercent.textContent = `${progress}%`;
                    
                    const circumference = this.getProgressRingCircumference();
                    const offset = circumference - (progress / 100) * circumference;
                    const progressRing = document.getElementById('progressRing');
                    if (progressRing) progressRing.style.strokeDashoffset = offset;
                    
                    const message = data.message || 'Downloading...';
                    if (this.els.singleProgressPhase) this.els.singleProgressPhase.textContent = message;
                    const phaseMobile = document.getElementById('singleProgressPhaseMobile');
                    if (phaseMobile) phaseMobile.textContent = message.length > 20 ? message.substring(0, 17) + '...' : message;
                    
                    if (data.speed && this.els.singleProgressSpeed) this.els.singleProgressSpeed.textContent = data.speed;
                    if (data.size && this.els.singleProgressSize) this.els.singleProgressSize.textContent = data.size;
                    if (data.eta && this.els.singleProgressEta) this.els.singleProgressEta.textContent = data.eta;
                    
                    if (data.phase === 'video') {
                        if (this.els.stepVideo) this.els.stepVideo.classList.add('active');
                        if (this.els.singleProgressStatus) this.els.singleProgressStatus.textContent = 'Video';
                        this.updateTimelineProgress(33);
                    } else if (data.phase === 'audio') {
                        if (this.els.stepVideo) {
                            this.els.stepVideo.classList.remove('active');
                            this.els.stepVideo.classList.add('completed');
                        }
                        if (this.els.stepAudio) this.els.stepAudio.classList.add('active');
                        if (this.els.singleProgressStatus) this.els.singleProgressStatus.textContent = 'Audio';
                        this.updateTimelineProgress(66);
                    }
                    break;
                    
                case 'merging':
                    if (this.els.singleProgressPhase) this.els.singleProgressPhase.textContent = 'Merging files...';
                    if (this.els.singleProgressPercent) this.els.singleProgressPercent.textContent = '95%';
                    
                    const circumference2 = this.getProgressRingCircumference();
                    const progressRing2 = document.getElementById('progressRing');
                    if (progressRing2) progressRing2.style.strokeDashoffset = circumference2 * 0.05; // 5% remaining
                    
                    if (this.els.stepAudio) {
                        this.els.stepAudio.classList.remove('active');
                        this.els.stepAudio.classList.add('completed');
                    }
                    if (this.els.stepMerge) this.els.stepMerge.classList.add('active');
                    if (this.els.singleProgressStatus) {
                        this.els.singleProgressStatus.textContent = 'Merging';
                        this.els.singleProgressStatus.className = 'stat-value';
                        this.els.singleProgressStatus.style.color = '#00BFA5';
                    }
                    this.updateTimelineProgress(90);
                    break;
                    
                case 'completed':
                    if (this.els.singleProgressPhase) this.els.singleProgressPhase.textContent = 'Download completed!';
                    if (this.els.singleProgressPercent) this.els.singleProgressPercent.textContent = '100%';
                    
                    const progressRing3 = document.getElementById('progressRing');
                    if (progressRing3) progressRing3.style.strokeDashoffset = 0;
                    
                    if (this.els.stepVideo) this.els.stepVideo.classList.add('completed');
                    if (this.els.stepAudio && !this.els.stepAudioContainer.classList.contains('d-none')) {
                        this.els.stepAudio.classList.add('completed');
                    }
                    if (this.els.stepMerge && !this.els.stepMergeContainer.classList.contains('d-none')) {
                        this.els.stepMerge.classList.remove('active');
                        this.els.stepMerge.classList.add('completed');
                    }
                    if (this.els.singleProgressStatus) {
                        this.els.singleProgressStatus.textContent = 'Completed';
                        this.els.singleProgressStatus.className = 'stat-value text-success';
                    }
                    this.updateTimelineProgress(100);
                    break;
                    
                case 'ready':
                    // Close modal and start download
                    if (this.state.singleProgressModalInstance) {
                        this.state.singleProgressModalInstance.hide();
                    }
                    window.location.href = `/download_file?session_id=${data.session_id}&filename=${encodeURIComponent(data.filename)}`;
                    break;
                    
                case 'cancelled':
                    if (this.els.singleProgressPhase) this.els.singleProgressPhase.textContent = 'Download cancelled';
                    if (this.els.singleProgressStatus) {
                        this.els.singleProgressStatus.textContent = 'Cancelled';
                        this.els.singleProgressStatus.className = 'stat-value text-warning';
                    }
                    this.showToast('Download cancelled by user', 'warning');
                    break;
                    
                case 'error':
                    if (this.els.singleProgressPhase) this.els.singleProgressPhase.textContent = `Error: ${data.message}`;
                    if (this.els.singleProgressStatus) {
                        this.els.singleProgressStatus.textContent = 'Error';
                        this.els.singleProgressStatus.className = 'stat-value text-danger';
                    }
                    this.showToast(data.message, 'danger');
                    break;
            }
        },

        updateAudioProgress(data) {
            const audioProgressPhase = document.getElementById('audioProgressPhase');
            const audioProgressPhaseMobile = document.getElementById('audioProgressPhaseMobile');
            const audioProgressPercent = document.getElementById('audioProgressPercent');
            const audioProgressSpeed = document.getElementById('audioProgressSpeed');
            const audioProgressSize = document.getElementById('audioProgressSize');
            const audioProgressEta = document.getElementById('audioProgressEta');
            const audioProgressStatus = document.getElementById('audioProgressStatus');
            
            switch (data.status) {
                case 'starting':
                    if (audioProgressPhase) audioProgressPhase.textContent = 'Starting download...';
                    if (audioProgressPhaseMobile) audioProgressPhaseMobile.textContent = 'Starting...';
                    break;
                    
                case 'downloading':
                    const progress = Math.round(data.progress || 0);
                    if (audioProgressPercent) audioProgressPercent.textContent = `${progress}%`;
                    
                    const circumference = this.getAudioProgressRingCircumference();
                    const offset = circumference - (progress / 100) * circumference;
                    const audioProgressRing = document.getElementById('audioProgressRing');
                    if (audioProgressRing) audioProgressRing.style.strokeDashoffset = offset;
                    
                    const message = data.message || 'Downloading...';
                    if (audioProgressPhase) audioProgressPhase.textContent = message;
                    if (audioProgressPhaseMobile) audioProgressPhaseMobile.textContent = message.length > 20 ? message.substring(0, 17) + '...' : message;
                    
                    if (data.speed && audioProgressSpeed) audioProgressSpeed.textContent = data.speed;
                    if (data.size && audioProgressSize) audioProgressSize.textContent = data.size;
                    if (data.eta && audioProgressEta) audioProgressEta.textContent = data.eta;
                    if (audioProgressStatus) audioProgressStatus.textContent = 'Downloading';
                    break;
                    
                case 'completed':
                    if (audioProgressPhase) audioProgressPhase.textContent = 'Download completed!';
                    if (audioProgressPhaseMobile) audioProgressPhaseMobile.textContent = 'Completed!';
                    if (audioProgressPercent) audioProgressPercent.textContent = '100%';
                    
                    const audioProgressRing2 = document.getElementById('audioProgressRing');
                    if (audioProgressRing2) audioProgressRing2.style.strokeDashoffset = 0;
                    
                    if (audioProgressStatus) {
                        audioProgressStatus.textContent = 'Completed';
                        audioProgressStatus.style.color = '#28a745';
                    }
                    break;
                    
                case 'ready':
                    if (this.state.audioProgressModalInstance) {
                        this.state.audioProgressModalInstance.hide();
                    }
                    window.location.href = `/download_file?session_id=${data.session_id}&filename=${encodeURIComponent(data.filename)}`;
                    break;
                    
                case 'cancelled':
                    if (audioProgressPhase) audioProgressPhase.textContent = 'Download cancelled';
                    if (audioProgressPhaseMobile) audioProgressPhaseMobile.textContent = 'Cancelled';
                    if (audioProgressStatus) {
                        audioProgressStatus.textContent = 'Cancelled';
                        audioProgressStatus.style.color = '#ffc107';
                    }
                    this.showToast('Download cancelled by user', 'warning');
                    break;
                    
                case 'error':
                    if (audioProgressPhase) audioProgressPhase.textContent = `Error: ${data.message}`;
                    if (audioProgressPhaseMobile) audioProgressPhaseMobile.textContent = 'Error';
                    if (audioProgressStatus) {
                        audioProgressStatus.textContent = 'Error';
                        audioProgressStatus.style.color = '#dc3545';
                    }
                    this.showToast(data.message, 'danger');
                    break;
            }
        },
        
        updateTimelineProgress(percentage) {
            const timelineProgress = document.getElementById('timelineProgress');
            if (timelineProgress) {
                timelineProgress.style.width = `${percentage}%`;
            }
        },

        async cancelPlaylistDownload() {
            if (this.state.sseConnection) {
                this.state.sseConnection.close();
                this.state.sseConnection = null;
            }
            if (this.state.progressModalInstance) {
                this.state.progressModalInstance.hide();
            }
            this.addToProgressLog('Download cancelled by user', 'warning');
            this.showToast('Playlist download cancelled', 'warning');
        },

        async closeSingleSseConnection() {
            // Send cancel request to server if we have a session ID
            if (this.state.currentSessionId) {
                try {
                    await fetch('/cancel_download', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ session_id: this.state.currentSessionId })
                    });
                } catch (e) {
                    console.error('Failed to cancel download:', e);
                }
            }
            
            if (this.state.singleSseConnection) {
                this.state.singleSseConnection.close();
                this.state.singleSseConnection = null;
            }
            if (this.state.singleProgressModalInstance) {
                this.state.singleProgressModalInstance.hide();
            }
            if (this.state.audioProgressModalInstance) {
                this.state.audioProgressModalInstance.hide();
            }
            
            // Reset session ID
            this.state.currentSessionId = null;
            
            // Only show cancellation message if user actually cancelled
            if (this.state.currentSessionId !== null) {
                if (this.els.singleProgressPhase) this.els.singleProgressPhase.textContent = 'Download cancelled';
                if (this.els.singleProgressStatus) {
                    this.els.singleProgressStatus.textContent = 'Cancelled';
                    this.els.singleProgressStatus.className = 'stat-value text-danger';
                }
                this.showToast('Download cancelled', 'warning');
            }
        },

        openVideoPlayer() {
            if (!this.state.lastVideoData) return;
            
            const embedUrl = this.state.lastVideoData.embed_url;
            if (!embedUrl) {
                this.showToast('Video preview not available for this platform', 'warning');
                return;
            }
            
            if (this.els.videoPlayerIframe) {
                this.els.videoPlayerIframe.src = embedUrl;
            }
            
            if (this.state.videoPlayerModalInstance) {
                this.state.videoPlayerModalInstance.show();
            }
        },

        shareVideo() {
            if (!this.state.lastVideoData) return;
            
            const shareData = {
                title: this.state.lastVideoData.title,
                text: `Check out this video: ${this.state.lastVideoData.title}`,
                url: this.state.lastVideoData.original_url
            };
            
            if (navigator.share) {
                navigator.share(shareData).catch(() => {
                    this.fallbackShare(shareData.url);
                });
            } else {
                this.fallbackShare(shareData.url);
            }
        },

        fallbackShare(url) {
            navigator.clipboard.writeText(url).then(() => {
                this.showToast('Video link copied to clipboard!', 'success');
            }).catch(() => {
                this.showToast('Unable to copy link. Please copy manually: ' + url, 'warning');
            });
        },

        setupPlaylistDownloadListeners(playlistData) {
            const downloadAllBtn = document.getElementById('downloadAllBtn');
            const downloadTop5Btn = document.getElementById('downloadTop5Btn');
            const downloadBottom5Btn = document.getElementById('downloadBottom5Btn');
            const downloadCustomRangeBtn = document.getElementById('downloadCustomRangeBtn');
            const qualitySelect = document.getElementById('qualitySelect');
            const customRangeStart = document.getElementById('customRangeStart');
            const customRangeEnd = document.getElementById('customRangeEnd');

            if (downloadAllBtn) {
                downloadAllBtn.onclick = () => {
                    if (confirm(`Download all ${playlistData.video_count} videos as ZIP file?`)) {
                        this.startPlaylistDownload(playlistData.original_url, 1, playlistData.video_count);
                    }
                };
            }

            if (downloadTop5Btn) {
                downloadTop5Btn.onclick = () => {
                    const count = Math.min(5, playlistData.video_count);
                    if (confirm(`Download first ${count} video(s)?`)) {
                        this.startPlaylistDownload(playlistData.original_url, 1, count);
                    }
                };
            }

            if (downloadBottom5Btn) {
                downloadBottom5Btn.onclick = () => {
                    const count = Math.min(5, playlistData.video_count);
                    const start = Math.max(1, playlistData.video_count - count + 1);
                    if (confirm(`Download last ${count} video(s)?`)) {
                        this.startPlaylistDownload(playlistData.original_url, start, playlistData.video_count);
                    }
                };
            }

            if (downloadCustomRangeBtn) {
                downloadCustomRangeBtn.onclick = () => {
                    const start = parseInt(customRangeStart.value);
                    const end = parseInt(customRangeEnd.value);
                    
                    // Validation
                    if (!start || !end) {
                        this.showToast('Please enter both start and end values.', 'warning');
                        return;
                    }
                    
                    if (start < 1 || end < 1) {
                        this.showToast('Start and end values must be greater than 0.', 'warning');
                        return;
                    }
                    
                    if (start > playlistData.video_count || end > playlistData.video_count) {
                        this.showToast(`Range cannot exceed playlist size (${playlistData.video_count} videos).`, 'warning');
                        return;
                    }
                    
                    if (start > end) {
                        this.showToast('Start value cannot be greater than end value.', 'warning');
                        return;
                    }
                    
                    const videoCount = end - start + 1;
                    if (confirm(`Download ${videoCount} video(s) from position ${start} to ${end}?`)) {
                        this.startPlaylistDownload(playlistData.original_url, start, end);
                    }
                };
            }
            
            // Set max values for range inputs
            if (customRangeStart) {
                customRangeStart.max = playlistData.video_count;
                customRangeStart.placeholder = `1-${playlistData.video_count}`;
            }
            if (customRangeEnd) {
                customRangeEnd.max = playlistData.video_count;
                customRangeEnd.placeholder = `1-${playlistData.video_count}`;
            }
        },

        startPlaylistDownload(url, start, end) {
            if (this.state.sseConnection) {
                this.showToast('A download is already in progress.', 'warning');
                return;
            }

            const quality = document.getElementById('qualitySelect')?.value || '1080';
            const params = new URLSearchParams({
                url: url,
                quality: quality,
                start: start,
                end: end
            });

            this.resetProgressModal();
            if (this.state.progressModalInstance) {
                this.state.progressModalInstance.show();
            }

            this.state.sseConnection = new EventSource(`/stream_playlist_download?${params.toString()}`);

            this.state.sseConnection.onmessage = (event) => {
                if (event.data === '[DONE]') {
                    // Close connection gracefully
                    if (this.state.sseConnection) {
                        this.state.sseConnection.close();
                        this.state.sseConnection = null;
                    }
                    return;
                }
                try {
                    const data = JSON.parse(event.data);
                    console.log('Received playlist data:', data); // Debug log
                    this.updatePlaylistProgress(data);
                } catch (e) {
                    console.error('Error parsing playlist SSE data:', e, 'Raw data:', event.data);
                }
            };

            this.state.sseConnection.onerror = (error) => {
                console.error('SSE Connection error:', error);
                // Only show error if connection wasn't completed successfully
                if (this.state.sseConnection && this.state.sseConnection.readyState !== EventSource.CLOSED) {
                    this.showToast('Connection to server lost.', 'danger');
                }
                this.closeSseConnection();
            };
        },

        resetProgressModal() {
            const progressStatusText = document.getElementById('progressStatusText');
            const progressBar = document.getElementById('progressBar');
            const progressLog = document.getElementById('progressLog');
            const progressPercentText = document.getElementById('progressPercentText');
            
            // Reset detailed stats
            const playlistSpeed = document.getElementById('playlistSpeed');
            const playlistSize = document.getElementById('playlistSize');
            const playlistEta = document.getElementById('playlistEta');
            const playlistPhase = document.getElementById('playlistPhase');
            const videoCounter = document.getElementById('videoCounter');
            const currentVideoTitle = document.getElementById('currentVideoTitle');

            if (progressStatusText) progressStatusText.textContent = 'Please wait while we prepare your download.';
            if (progressBar) {
                progressBar.style.width = '0%';
                progressBar.textContent = '0%';
                progressBar.classList.add('progress-bar-striped', 'progress-bar-animated');
            }
            if (progressPercentText) progressPercentText.textContent = '0%';
            
            // Reset detailed elements
            if (playlistSpeed) playlistSpeed.textContent = '0 MB/s';
            if (playlistSize) playlistSize.textContent = '0 MB / 0 MB';
            if (playlistEta) playlistEta.textContent = 'N/A';
            if (playlistPhase) {
                playlistPhase.textContent = 'Starting';
                playlistPhase.style.color = 'var(--secondary-color)';
            }
            if (videoCounter) videoCounter.textContent = '0/0';
            if (currentVideoTitle) currentVideoTitle.textContent = 'Initializing download...';
            
            if (progressLog) {
                progressLog.innerHTML = '';
                this.addToProgressLog('Initializing playlist download...', 'info');
            }
        },

        updatePlaylistProgress(data) {
            const progressStatusText = document.getElementById('progressStatusText');
            const progressBar = document.getElementById('progressBar');
            const progressLog = document.getElementById('progressLog');
            const progressPercentText = document.getElementById('progressPercentText');
            
            // New detailed elements
            const playlistSpeed = document.getElementById('playlistSpeed');
            const playlistSize = document.getElementById('playlistSize');
            const playlistEta = document.getElementById('playlistEta');
            const playlistPhase = document.getElementById('playlistPhase');
            const videoCounter = document.getElementById('videoCounter');
            const currentVideoTitle = document.getElementById('currentVideoTitle');

            console.log('Playlist progress update:', data);

            // Update detailed stats if available
            if (data.speed && playlistSpeed) playlistSpeed.textContent = data.speed;
            if (data.size && playlistSize) playlistSize.textContent = data.size;
            if (data.eta && playlistEta) playlistEta.textContent = data.eta;
            if (data.phase && playlistPhase) {
                playlistPhase.textContent = data.phase;
                // Update phase color based on status
                const phaseColors = {
                    'Starting': 'var(--primary-color)',
                    'Video': 'var(--primary-color)',
                    'Audio': 'var(--secondary-color)',
                    'Video+Audio': 'var(--primary-color)',
                    'Merging': '#ff6b35',
                    'Zipping': '#28a745',
                    'Completed': '#28a745',
                    'Error': '#dc3545'
                };
                playlistPhase.style.color = phaseColors[data.phase] || 'var(--secondary-color)';
            }
            
            if (data.current_video && data.total_videos && videoCounter) {
                videoCounter.textContent = `${data.current_video}/${data.total_videos}`;
            }
            
            if (data.video_title && currentVideoTitle) {
                const truncatedTitle = data.video_title.length > 80 ? 
                    data.video_title.substring(0, 77) + '...' : data.video_title;
                currentVideoTitle.textContent = truncatedTitle;
            }

            switch (data.status) {
                case 'starting':
                    if (progressStatusText) {
                        progressStatusText.textContent = data.message || `Starting download of ${data.total_videos} videos...`;
                    }
                    this.addToProgressLog(`Starting download of ${data.total_videos} videos`, 'info');
                    break;

                case 'downloading':
                    if (data.current_video && data.total_videos) {
                        // Use the overall progress from backend if available, otherwise calculate
                        const percent = data.progress !== undefined ? Math.round(data.progress) : 
                            Math.min(90, Math.round((data.current_video / data.total_videos) * 90));
                        if (progressBar) {
                            progressBar.style.width = `${percent}%`;
                            progressBar.textContent = `${percent}%`;
                        }
                        if (progressPercentText) progressPercentText.textContent = `${percent}%`;
                        if (progressStatusText) {
                            progressStatusText.textContent = data.message || `Downloading video ${data.current_video} of ${data.total_videos}...`;
                        }
                        
                        // Log significant events
                        if (data.phase === 'Starting') {
                            this.addToProgressLog(`Starting: ${data.video_title}`, 'info');
                        } else if (data.phase === 'Completed') {
                            this.addToProgressLog(`✓ Completed video ${data.current_video}/${data.total_videos}`, 'success');
                        } else if (data.phase === 'Error') {
                            this.addToProgressLog(`✗ Failed video ${data.current_video}`, 'error');
                        }
                    }
                    break;

                case 'zipping':
                    if (progressStatusText) {
                        progressStatusText.textContent = 'Creating ZIP file...';
                    }
                    if (progressBar) {
                        progressBar.style.width = '95%';
                        progressBar.textContent = '95%';
                    }
                    if (progressPercentText) progressPercentText.textContent = '95%';
                    if (currentVideoTitle) currentVideoTitle.textContent = 'Creating ZIP archive...';
                    this.addToProgressLog('Creating ZIP archive', 'info');
                    break;

                case 'finished':
                    if (progressStatusText) {
                        progressStatusText.textContent = 'Download completed! Starting file download...';
                    }
                    if (progressBar) {
                        progressBar.style.width = '100%';
                        progressBar.textContent = '100%';
                    }
                    if (progressPercentText) progressPercentText.textContent = '100%';
                    if (playlistPhase) {
                        playlistPhase.textContent = 'Completed';
                        playlistPhase.style.color = '#28a745';
                    }
                    if (currentVideoTitle) currentVideoTitle.textContent = 'All videos downloaded successfully!';
                    this.addToProgressLog('✓ Download completed successfully!', 'success');
                    
                    setTimeout(() => {
                        if (this.state.progressModalInstance) {
                            this.state.progressModalInstance.hide();
                        }
                        window.location.href = `/download_zip?session_id=${data.session_id}&zip_name=${encodeURIComponent(data.zip_name)}`;
                    }, 1000);
                    break;

                case 'error':
                    if (progressStatusText) {
                        progressStatusText.textContent = `Error: ${data.message}`;
                    }
                    if (playlistPhase) {
                        playlistPhase.textContent = 'Error';
                        playlistPhase.style.color = '#dc3545';
                    }
                    this.addToProgressLog(`✗ Error: ${data.message}`, 'error');
                    this.showToast(data.message, 'danger');
                    break;
            }
        },

        addToProgressLog(message, type = 'info') {
            const progressLog = document.getElementById('progressLog');
            if (!progressLog) return;

            const iconMap = {
                info: 'bi-info-circle',
                success: 'bi-check-circle',
                error: 'bi-exclamation-circle',
                warning: 'bi-exclamation-triangle'
            };

            const colorMap = {
                info: 'text-primary',
                success: 'text-success',
                error: 'text-danger',
                warning: 'text-warning'
            };

            const timestamp = new Date().toLocaleTimeString();
            const logItem = document.createElement('li');
            logItem.className = 'mb-2 p-2 rounded';
            logItem.style.background = 'rgba(var(--bs-body-color-rgb), 0.05)';
            logItem.innerHTML = `
                <div class="d-flex align-items-center">
                    <i class="bi ${iconMap[type]} ${colorMap[type]} me-2"></i>
                    <span class="flex-grow-1">${message}</span>
                    <small class="text-muted">${timestamp}</small>
                </div>
            `;

            progressLog.appendChild(logItem);
            
            // Auto-scroll to bottom
            const container = progressLog.parentElement;
            if (container) {
                container.scrollTop = container.scrollHeight;
            }
        },

        closeSseConnection() {
            if (this.state.sseConnection) {
                this.state.sseConnection.close();
                this.state.sseConnection = null;
            }
            // Don't auto-hide modal on connection close - let user decide
        },

        loadHistory() {
            if (!this.els.historyTableBody) return;
            const history = this.getHistory();
            
            if (history.length === 0) {
                this.els.historyTableBody.innerHTML = `
                    <tr>
                        <td colspan="5" class="text-center text-body-secondary py-5">
                            <h4><i class="bi bi-clock-history"></i></h4>
                            <p class="mb-0">Your download history is empty.</p>
                            <small>Items will appear here after you download a single video.</small>
                        </td>
                    </tr>
                `;
                if (this.els.clearHistoryBtn) this.els.clearHistoryBtn.classList.add('d-none');
            } else {
                if (this.els.clearHistoryBtn) this.els.clearHistoryBtn.classList.remove('d-none');
                this.els.historyTableBody.innerHTML = history.map((item, index) => `
                    <tr>
                        <td><img src="${item.thumbnail}" class="history-thumbnail" alt="Thumbnail"></td>
                        <td>${item.title}</td>
                        <td><i class="bi bi-${this.getPlatformIcon(item.platform)}"></i> ${item.platform.charAt(0).toUpperCase() + item.platform.slice(1)}</td>
                        <td>${new Date(item.date).toLocaleDateString()}</td>
                        <td>
                            <button class="btn btn-sm btn-primary redownload-btn" data-url="${item.original_url}" title="Re-download">
                                <i class="bi bi-arrow-clockwise"></i>
                            </button> 
                            <button class="btn btn-sm btn-danger delete-history-btn" data-index="${index}" title="Delete">
                                <i class="bi bi-trash"></i>
                            </button>
                        </td>
                    </tr>
                `).join('');
            }
        },
        
        getHistory() {
            return JSON.parse(localStorage.getItem('downloadHistory') || '[]');
        },
        
        deleteHistoryItem(index) {
            let history = this.getHistory();
            history.splice(index, 1);
            localStorage.setItem('downloadHistory', JSON.stringify(history));
        },
        
        clearHistory() {
            localStorage.removeItem('downloadHistory');
        },

        saveToHistory(videoData) {
            let history = JSON.parse(localStorage.getItem('downloadHistory') || '[]');
            history = history.filter(item => item.original_url !== videoData.original_url);
            history.unshift({
                title: videoData.title,
                original_url: videoData.original_url,
                thumbnail: videoData.thumbnail,
                platform: videoData.platform,
                date: new Date().toISOString()
            });
            if (history.length > 50) history.pop();
            localStorage.setItem('downloadHistory', JSON.stringify(history));
        },

        calculateTotalDuration(videos) {
            if (!videos || videos.length === 0) return null;
            
            let totalSeconds = 0;
            let validDurations = 0;
            
            videos.forEach(video => {
                if (video.duration && video.duration !== 'N/A') {
                    const parts = video.duration.split(':');
                    if (parts.length === 2) {
                        // MM:SS format
                        totalSeconds += parseInt(parts[0]) * 60 + parseInt(parts[1]);
                        validDurations++;
                    } else if (parts.length === 3) {
                        // HH:MM:SS format
                        totalSeconds += parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2]);
                        validDurations++;
                    }
                }
            });
            
            if (validDurations === 0) return null;
            
            const hours = Math.floor(totalSeconds / 3600);
            const minutes = Math.floor((totalSeconds % 3600) / 60);
            
            if (hours > 0) {
                return `~${hours}h ${minutes}m`;
            } else {
                return `~${minutes}m`;
            }
        },

        getPlatformIcon(platform = '') {
            const p = platform.toLowerCase();
            const icons = {
                youtube: 'youtube',
                instagram: 'instagram',
                facebook: 'facebook',
                twitter: 'twitter',
                x: 'twitter-x'
            };
            return icons[p] || 'globe';
        },

        showToast(message, type = 'info') {
            if (!this.els.toastContainer) return;
            
            const toastId = 'toast-' + Date.now();
            const toastHtml = `
                <div id="${toastId}" class="toast align-items-center text-bg-${type} border-0" role="alert">
                    <div class="d-flex">
                        <div class="toast-body">${message}</div>
                        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
                    </div>
                </div>
            `;
            
            this.els.toastContainer.insertAdjacentHTML('beforeend', toastHtml);
            const toast = new bootstrap.Toast(document.getElementById(toastId), { delay: 5000 });
            toast.show();
            
            document.getElementById(toastId).addEventListener('hidden.bs.toast', (e) => e.target.remove());
        }
    };
    App.init();
});