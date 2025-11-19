
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Layer, BlendMode, AIRequestState, ColorCorrection } from './types';
import { generateAsset, editLayerImage, removeBackground } from './services/geminiService';
import { 
  Layers as IconLayers, 
  Plus, 
  Wand2, 
  Move, 
  Trash2, 
  Eye, 
  EyeOff, 
  Lock, 
  Unlock, 
  Download, 
  ImageIcon,
  SlidersHorizontal,
  X,
  Check,
  Sparkles,
  Menu,
  Scissors,
  RefreshCcw,
  ChevronUp,
  ChevronDown
} from './components/Icons';
import { Button, Slider, Modal } from './components/UIComponents';
import { BLEND_MODES, INITIAL_LAYER_WIDTH } from './constants';

const MAX_ZOOM = 5;
const MIN_ZOOM = 0.1;

const DEFAULT_COLOR_CORRECTION: ColorCorrection = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
  hue: 0,
  blur: 0
};

export default function App() {
  // State
  const [layers, setLayers] = useState<Layer[]>([]);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [showLayersPanel, setShowLayersPanel] = useState(false);
  const [showPropsPanel, setShowPropsPanel] = useState(false);
  const [showAIModal, setShowAIModal] = useState(false);
  
  // Canvas Viewport State
  const [viewport, setViewport] = useState({ x: 0, y: 0, scale: 1 });
  
  // AI State
  const [aiState, setAiState] = useState<AIRequestState>({ isLoading: false, error: null });
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiMode, setAiMode] = useState<'create' | 'edit'>('create');

  // Export State
  const [isExporting, setIsExporting] = useState(false);

  // Refs for interaction
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Interaction State Refs
  const dragStartRef = useRef<{ x: number, y: number } | null>(null);
  const initialLayerStateRef = useRef<{ x: number, y: number } | null>(null);
  const isDraggingLayerRef = useRef(false);
  
  // Transform Refs (Scale/Rotate)
  const transformRef = useRef<{
    type: 'rotate' | 'scale';
    startVal: number; // Initial Rotation (deg) or Scale (float)
    startCursorAngle?: number; // For rotation
    startCursorDist?: number; // For scaling
    centerX: number;
    centerY: number;
  } | null>(null);

  // --- Helpers ---
  
  const getSelectedLayer = () => layers.find(l => l.id === selectedLayerId);

  const updateLayer = (id: string, updates: Partial<Layer>) => {
    setLayers(prev => prev.map(l => l.id === id ? { ...l, ...updates } : l));
  };

  const getFilterString = (cc: ColorCorrection) => {
    return `brightness(${cc.brightness}%) contrast(${cc.contrast}%) saturate(${cc.saturation}%) hue-rotate(${cc.hue}deg) blur(${cc.blur}px)`;
  };

  const addLayer = (src: string, name = 'New Layer') => {
    const id = Date.now().toString();
    const newLayer: Layer = {
      id,
      name,
      type: 'image',
      src,
      originalSrc: src, // Store original for non-destructive edits
      x: (window.innerWidth / 2) - (INITIAL_LAYER_WIDTH / 2) - viewport.x,
      y: (window.innerHeight / 2) - (INITIAL_LAYER_WIDTH / 2) - viewport.y,
      width: INITIAL_LAYER_WIDTH,
      height: INITIAL_LAYER_WIDTH, // Will adjust on load
      rotation: 0,
      scale: 1,
      opacity: 1,
      blendMode: BlendMode.NORMAL,
      isVisible: true,
      isLocked: false,
      isMasked: false,
      zIndex: layers.length + 1,
      colorCorrection: { ...DEFAULT_COLOR_CORRECTION }
    };
    setLayers(prev => [...prev, newLayer]);
    setSelectedLayerId(id);
    
    // Adjust aspect ratio after load
    const img = new Image();
    img.src = src;
    img.onload = () => {
      const ratio = img.width / img.height;
      updateLayer(id, { 
        width: INITIAL_LAYER_WIDTH,
        height: INITIAL_LAYER_WIDTH / ratio 
      });
    };
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const reader = new FileReader();
      reader.onload = (evt) => {
        if (evt.target?.result) {
          addLayer(evt.target.result as string, "Image Layer");
        }
      };
      reader.readAsDataURL(e.target.files[0]);
    }
  };

  const moveLayer = (id: string, direction: 'up' | 'down') => {
    setLayers(prev => {
      // Create a copy and sort by current zIndex to ensure order
      const sorted = [...prev].sort((a, b) => a.zIndex - b.zIndex);
      const index = sorted.findIndex(l => l.id === id);
      
      if (index === -1) return prev;
      if (direction === 'up' && index === sorted.length - 1) return prev;
      if (direction === 'down' && index === 0) return prev;

      const targetIndex = direction === 'up' ? index + 1 : index - 1;
      
      // Swap z-indices
      const tempZ = sorted[index].zIndex;
      sorted[index].zIndex = sorted[targetIndex].zIndex;
      sorted[targetIndex].zIndex = tempZ;

      // Return new array (order in array doesn't strictly matter for rendering if zIndex is used, 
      // but keeping them somewhat synced is good for the list)
      return [...sorted].sort((a, b) => a.zIndex - b.zIndex);
    });
  };

  // --- Export Logic ---

  const handleExport = async () => {
    if (layers.length === 0) return;
    setIsExporting(true);

    try {
      // 1. Calculate Bounding Box of all visible layers
      const visibleLayers = layers.filter(l => l.isVisible);
      if (visibleLayers.length === 0) throw new Error("No visible layers");

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

      visibleLayers.forEach(layer => {
        // Calculate transformed corners
        const cx = layer.x + layer.width / 2;
        const cy = layer.y + layer.height / 2;
        const corners = [
          { x: -layer.width / 2, y: -layer.height / 2 },
          { x: layer.width / 2, y: -layer.height / 2 },
          { x: layer.width / 2, y: layer.height / 2 },
          { x: -layer.width / 2, y: layer.height / 2 },
        ];
        const rad = layer.rotation * (Math.PI / 180);
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);

        corners.forEach(p => {
          // Apply Scale & Rotation
          const tx = cx + (p.x * layer.scale * cos - p.y * layer.scale * sin);
          const ty = cy + (p.x * layer.scale * sin + p.y * layer.scale * cos);
          if (tx < minX) minX = tx;
          if (tx > maxX) maxX = tx;
          if (ty < minY) minY = ty;
          if (ty > maxY) maxY = ty;
        });
      });

      // Add some padding
      const padding = 0;
      minX -= padding; minY -= padding;
      maxX += padding; maxY += padding;

      const width = Math.abs(maxX - minX);
      const height = Math.abs(maxY - minY);

      // 2. Create Canvas
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error("Could not get canvas context");

      // 3. Draw Layers
      // Translate to make minX, minY the origin (0,0)
      ctx.translate(-minX, -minY);

      // Sort by zIndex
      const sortedLayers = [...visibleLayers].sort((a, b) => a.zIndex - b.zIndex);

      for (const layer of sortedLayers) {
        // Load Image
        await new Promise<void>((resolve, reject) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.src = layer.src;
          img.onload = () => {
            ctx.save();
            
            // Position center
            const cx = layer.x + layer.width / 2;
            const cy = layer.y + layer.height / 2;
            ctx.translate(cx, cy);
            
            // Rotate
            ctx.rotate(layer.rotation * Math.PI / 180);
            
            // Scale
            ctx.scale(layer.scale, layer.scale);
            
            // Blend Mode & Opacity
            ctx.globalAlpha = layer.opacity;
            ctx.globalCompositeOperation = layer.blendMode === BlendMode.NORMAL ? 'source-over' : layer.blendMode;
            
            // Apply Filters
            ctx.filter = getFilterString(layer.colorCorrection);

            // Draw centered
            ctx.drawImage(img, -layer.width / 2, -layer.height / 2, layer.width, layer.height);
            
            ctx.restore();
            resolve();
          };
          img.onerror = () => resolve(); // Skip error layers but continue
        });
      }

      // 4. Download
      const dataUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.download = `composition-${Date.now()}.png`;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

    } catch (error) {
      console.error("Export failed:", error);
      alert("Could not export image.");
    } finally {
      setIsExporting(false);
    }
  };

  // --- AI Handlers ---

  const handleAIGenerate = async () => {
    if (!aiPrompt.trim()) return;
    setAiState({ isLoading: true, error: null });

    try {
      if (aiMode === 'create') {
        const assetBase64 = await generateAsset(aiPrompt);
        addLayer(assetBase64, `AI: ${aiPrompt.slice(0, 10)}...`);
        setShowAIModal(false);
      } else if (aiMode === 'edit' && selectedLayerId) {
        const layer = getSelectedLayer();
        if (layer) {
          const editedBase64 = await editLayerImage(layer.src, aiPrompt);
          // Add as new layer or replace? For remix, let's add new layer on top
          addLayer(editedBase64, `Edit: ${aiPrompt.slice(0, 10)}...`);
          setShowAIModal(false);
        }
      }
    } catch (err) {
      setAiState({ isLoading: false, error: "Failed to generate. Please try again." });
    } finally {
      setAiState(prev => ({ ...prev, isLoading: false }));
    }
  };

  const handleRemoveBackground = async () => {
    if (!selectedLayerId) return;
    const layer = getSelectedLayer();
    if (!layer) return;

    setAiState({ isLoading: true, error: null });
    try {
      // If already masked, restore original
      if (layer.isMasked && layer.originalSrc) {
        updateLayer(layer.id, {
          src: layer.originalSrc,
          isMasked: false
        });
      } else {
        // Remove Background
        const maskedImageBase64 = await removeBackground(layer.src);
        updateLayer(layer.id, {
          src: maskedImageBase64,
          isMasked: true,
          originalSrc: layer.originalSrc || layer.src // Ensure we keep original
        });
      }
    } catch (err) {
      setAiState({ isLoading: false, error: "Failed to remove background." });
      alert("Could not remove background. Try again.");
    } finally {
      setAiState(prev => ({ ...prev, isLoading: false }));
    }
  };

  // --- Interaction Logic (Mouse/Touch) ---

  const handlePointerDown = (e: React.PointerEvent, layerId?: string) => {
    // If we are clicking a transform handle, this function is NOT called (stopPropagation on handles)
    // But if we click the layer body...
    
    if (layerId) {
      e.stopPropagation(); // Prevent canvas drag
      const layer = layers.find(l => l.id === layerId);
      if (layer && !layer.isLocked) {
        setSelectedLayerId(layerId);
        isDraggingLayerRef.current = true;
        dragStartRef.current = { x: e.clientX, y: e.clientY };
        initialLayerStateRef.current = { x: layer.x, y: layer.y };
      }
    } else {
      // Pan canvas
      isDraggingLayerRef.current = false;
      dragStartRef.current = { x: e.clientX, y: e.clientY };
      initialLayerStateRef.current = { x: viewport.x, y: viewport.y };
    }
  };

  const handleTransformStart = (e: React.PointerEvent, type: 'rotate' | 'scale') => {
    e.stopPropagation();
    e.preventDefault();
    
    const layer = getSelectedLayer();
    if (!layer) return;

    // Calculate Center of Layer in Screen Coordinates
    const layerCenterX = (layer.x + layer.width / 2);
    const layerCenterY = (layer.y + layer.height / 2);
    
    // Apply Viewport Transform to get Screen Center
    const screenCenterX = layerCenterX * viewport.scale + viewport.x;
    const screenCenterY = layerCenterY * viewport.scale + viewport.y;

    if (type === 'rotate') {
      const angle = Math.atan2(e.clientY - screenCenterY, e.clientX - screenCenterX);
      transformRef.current = {
        type: 'rotate',
        startVal: layer.rotation,
        startCursorAngle: angle,
        centerX: screenCenterX,
        centerY: screenCenterY
      };
    } else {
      // Scale
      const dist = Math.hypot(e.clientX - screenCenterX, e.clientY - screenCenterY);
      transformRef.current = {
        type: 'scale',
        startVal: layer.scale,
        startCursorDist: dist,
        centerX: screenCenterX,
        centerY: screenCenterY
      };
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    // 1. Handle Transform (Scale/Rotate)
    if (transformRef.current && selectedLayerId) {
      const { type, startVal, centerX, centerY } = transformRef.current;
      
      if (type === 'rotate') {
        const currentAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX);
        const startAngle = transformRef.current.startCursorAngle || 0;
        const delta = currentAngle - startAngle;
        const deltaDeg = delta * (180 / Math.PI);
        updateLayer(selectedLayerId, { rotation: startVal + deltaDeg });
      } else {
        // Scale
        const currentDist = Math.hypot(e.clientX - centerX, e.clientY - centerY);
        const startDist = transformRef.current.startCursorDist || 1;
        const scaleRatio = currentDist / startDist;
        const newScale = Math.max(0.1, startVal * scaleRatio); // limit min scale
        updateLayer(selectedLayerId, { scale: newScale });
      }
      return;
    }

    // 2. Handle Move / Pan
    if (!dragStartRef.current || !initialLayerStateRef.current) return;

    const startX = dragStartRef.current.x;
    const startY = dragStartRef.current.y;
    const initialX = initialLayerStateRef.current.x;
    const initialY = initialLayerStateRef.current.y;

    if (isDraggingLayerRef.current && selectedLayerId) {
       const layer = layers.find(l => l.id === selectedLayerId);
       if(layer && !layer.isLocked) {
          // Delta in screen pixels, divided by scale to get world pixels
          const dx = (e.clientX - startX) / viewport.scale;
          const dy = (e.clientY - startY) / viewport.scale;
          updateLayer(selectedLayerId, {
            x: initialX + dx,
            y: initialY + dy
          });
       }
    } else if (!isDraggingLayerRef.current) {
      // Pan Viewport
      const panDx = e.clientX - startX;
      const panDy = e.clientY - startY;
      
      setViewport(prev => ({
        ...prev,
        x: initialX + panDx,
        y: initialY + panDy
      }));
    }
  };

  const handlePointerUp = () => {
    dragStartRef.current = null;
    initialLayerStateRef.current = null;
    isDraggingLayerRef.current = false;
    transformRef.current = null;
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
        e.preventDefault(); // Prevent browser zoom logic often attached
        const scaleAmount = -e.deltaY * 0.001;
        setViewport(prev => ({
            ...prev,
            scale: Math.min(Math.max(prev.scale + scaleAmount, MIN_ZOOM), MAX_ZOOM)
        }));
    }
  };

  // --- Render ---

  const activeLayer = getSelectedLayer();

  // Sort layers by zIndex for rendering
  const sortedLayers = [...layers].sort((a, b) => a.zIndex - b.zIndex);

  return (
    <div className="fixed inset-0 w-full h-full bg-[#0f0f10] text-zinc-100 flex flex-col overflow-hidden">
      
      {/* --- Top Bar --- */}
      <div className="h-14 bg-[#18181b] border-b border-zinc-800 flex items-center justify-between px-4 z-20">
        <div className="font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400">
          CompoAI
        </div>
        <Button 
          variant="ghost" 
          className="text-xs h-8" 
          onClick={handleExport}
          disabled={isExporting || layers.length === 0}
        >
          {isExporting ? (
            <div className="w-3 h-3 border-2 border-zinc-400 border-t-transparent rounded-full animate-spin" />
          ) : (
            <Download size={16} />
          )}
          Export
        </Button>
      </div>

      {/* --- Canvas Area --- */}
      <div 
        ref={containerRef}
        className="flex-1 relative overflow-hidden bg-checkerboard cursor-grab active:cursor-grabbing touch-none"
        onPointerDown={(e) => handlePointerDown(e)}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onWheel={handleWheel}
      >
        {/* Transform Container for Viewport */}
        <div 
          className="isolate" 
          style={{
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
            transformOrigin: '0 0',
            width: '100%',
            height: '100%',
            pointerEvents: 'none'
          }}
        >
          {sortedLayers.map((layer) => (
            layer.isVisible && (
              <div
                key={layer.id}
                style={{
                  position: 'absolute',
                  left: layer.x,
                  top: layer.y,
                  width: layer.width,
                  height: layer.height,
                  transform: `rotate(${layer.rotation}deg) scale(${layer.scale})`,
                  opacity: layer.opacity,
                  mixBlendMode: layer.blendMode as any,
                  zIndex: layer.zIndex,
                  pointerEvents: 'auto', 
                  cursor: layer.isLocked ? 'not-allowed' : 'move',
                }}
                onPointerDown={(e) => handlePointerDown(e, layer.id)}
              >
                <img 
                  src={layer.src} 
                  alt={layer.name} 
                  className="w-full h-full block pointer-events-none select-none" 
                  draggable={false}
                  style={{
                    filter: getFilterString(layer.colorCorrection)
                  }}
                />
                
                {/* On-Canvas Controls */}
                {selectedLayerId === layer.id && !layer.isLocked && (
                   <>
                     {/* Border */}
                     <div className="absolute inset-0 border-2 border-blue-500 pointer-events-none" />
                     
                     {/* Name Tag */}
                     <div 
                        className="absolute -top-8 left-0 bg-blue-600 text-white text-[10px] px-1 rounded whitespace-nowrap z-50"
                        style={{ transform: `scale(${1/layer.scale})`, transformOrigin: 'bottom left' }}
                     >
                        {layer.name}
                     </div>

                     {/* Rotation Handle */}
                     <div 
                        className="absolute -top-8 left-1/2 w-px h-8 bg-blue-500" 
                        style={{ transform: `translateX(-50%) scaleY(${1/layer.scale})`, transformOrigin: 'bottom' }}
                     />
                     <div 
                        className="absolute -top-10 left-1/2 w-6 h-6 bg-white border-2 border-blue-500 rounded-full cursor-grab flex items-center justify-center z-50 shadow-md"
                        style={{ 
                           transform: `translateX(-50%) scale(${1/layer.scale})`, 
                           transformOrigin: 'center',
                           touchAction: 'none'
                        }}
                        onPointerDown={(e) => handleTransformStart(e, 'rotate')}
                     >
                        <RefreshCcw size={10} className="text-blue-600" />
                     </div>

                     {/* Corner Scale Handles */}
                     {[
                       { pos: '-top-2 -left-2', cursor: 'nwse' },
                       { pos: '-top-2 -right-2', cursor: 'nesw' },
                       { pos: '-bottom-2 -left-2', cursor: 'nesw' },
                       { pos: '-bottom-2 -right-2', cursor: 'nwse' }
                     ].map((h, i) => (
                        <div 
                           key={i}
                           className={`absolute ${h.pos} w-4 h-4 bg-white border-2 border-blue-500 rounded-full z-50 shadow-sm`}
                           style={{ 
                             transform: `scale(${1/layer.scale})`, 
                             transformOrigin: 'center',
                             cursor: 'pointer', // standard cursor to avoid confusion if rotated
                             touchAction: 'none'
                           }}
                           onPointerDown={(e) => handleTransformStart(e, 'scale')}
                        />
                     ))}
                   </>
                )}
              </div>
            )
          ))}
        </div>
        
        {/* Canvas Overlay Info */}
        <div className="absolute bottom-20 left-4 text-xs text-zinc-500 pointer-events-none bg-black/50 px-2 py-1 rounded backdrop-blur-sm">
           Zoom: {Math.round(viewport.scale * 100)}%
        </div>
      </div>

      {/* --- Bottom Toolbar --- */}
      <div className="h-16 bg-[#18181b] border-t border-zinc-800 flex items-center justify-around px-2 z-20 pb-safe">
        <button 
          onClick={() => setShowLayersPanel(!showLayersPanel)}
          className={`p-2 rounded-full flex flex-col items-center gap-1 ${showLayersPanel ? 'text-blue-400' : 'text-zinc-400'}`}
        >
          <IconLayers size={20} />
          <span className="text-[10px]">Layers</span>
        </button>

        <div className="relative">
           <input 
             type="file" 
             accept="image/*" 
             onChange={handleFileSelect} 
             className="hidden" 
             id="file-upload"
           />
           <label htmlFor="file-upload" className="bg-blue-600 text-white p-3 rounded-full shadow-lg shadow-blue-900/20 active:scale-95 transition-transform flex items-center justify-center cursor-pointer">
             <Plus size={24} />
           </label>
        </div>

        <button 
          onClick={() => setShowPropsPanel(!showPropsPanel)}
          className={`p-2 rounded-full flex flex-col items-center gap-1 ${showPropsPanel ? 'text-blue-400' : 'text-zinc-400'}`}
          disabled={!selectedLayerId}
        >
          <SlidersHorizontal size={20} />
          <span className="text-[10px]">Edit</span>
        </button>
        
        <button 
           onClick={() => {
             setAiMode('create');
             setShowAIModal(true);
           }}
           className="p-2 rounded-full flex flex-col items-center gap-1 text-purple-400 hover:text-purple-300"
        >
          <Sparkles size={20} />
          <span className="text-[10px]">AI Gen</span>
        </button>
      </div>

      {/* --- Layers Panel --- */}
      {showLayersPanel && (
        <div className="absolute bottom-16 left-0 right-0 h-[50vh] bg-[#18181b] rounded-t-2xl border-t border-zinc-800 shadow-2xl z-10 animate-in slide-in-from-bottom-10">
          <div className="flex justify-between items-center p-4 border-b border-zinc-800">
            <h3 className="font-semibold">Layers</h3>
            <button onClick={() => setShowLayersPanel(false)}><X size={20} className="text-zinc-400" /></button>
          </div>
          <div className="p-2 overflow-y-auto h-[calc(50vh-60px)] space-y-2">
            {/* Reverse copy for display so top layer is top of list */}
            {sortedLayers.slice().reverse().map((layer) => (
              <div 
                key={layer.id}
                onClick={() => setSelectedLayerId(layer.id)}
                className={`flex items-center p-2 rounded-lg gap-3 ${selectedLayerId === layer.id ? 'bg-zinc-800' : 'hover:bg-zinc-800/50'}`}
              >
                <div className="relative w-10 h-10 flex-shrink-0">
                   <img src={layer.src} alt="" className="w-10 h-10 rounded object-cover bg-checkerboard" />
                   {layer.isMasked && (
                     <div className="absolute -top-1 -right-1 bg-blue-600 rounded-full p-0.5 border border-zinc-900">
                        <Scissors size={8} className="text-white" />
                     </div>
                   )}
                </div>
                
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{layer.name}</p>
                  <p className="text-xs text-zinc-500">{layer.blendMode}</p>
                </div>

                {/* Z-Order Controls */}
                <div className="flex flex-col">
                  <button 
                    onClick={(e) => { e.stopPropagation(); moveLayer(layer.id, 'up'); }}
                    className="text-zinc-400 hover:text-white p-0.5"
                  >
                    <ChevronUp size={14} />
                  </button>
                  <button 
                    onClick={(e) => { e.stopPropagation(); moveLayer(layer.id, 'down'); }}
                    className="text-zinc-400 hover:text-white p-0.5"
                  >
                    <ChevronDown size={14} />
                  </button>
                </div>

                <div className="flex items-center gap-1 text-zinc-400 ml-2">
                  <button onClick={(e) => { e.stopPropagation(); updateLayer(layer.id, { isVisible: !layer.isVisible })}}>
                    {layer.isVisible ? <Eye size={16} /> : <EyeOff size={16} />}
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); updateLayer(layer.id, { isLocked: !layer.isLocked })}}>
                    {layer.isLocked ? <Lock size={16} /> : <Unlock size={16} />}
                  </button>
                  <button 
                    onClick={(e) => { 
                      e.stopPropagation(); 
                      setLayers(prev => prev.filter(l => l.id !== layer.id));
                      if(selectedLayerId === layer.id) setSelectedLayerId(null);
                    }}
                    className="text-red-400 hover:text-red-300 ml-1"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* --- Properties Panel --- */}
      {showPropsPanel && activeLayer && (
        <div className="absolute bottom-16 left-0 right-0 bg-[#18181b] rounded-t-2xl border-t border-zinc-800 shadow-2xl z-10 p-4 animate-in slide-in-from-bottom-10 overflow-y-auto max-h-[60vh]">
           <div className="flex justify-between items-center mb-4">
            <h3 className="font-semibold">Properties</h3>
            <button onClick={() => setShowPropsPanel(false)}><X size={20} className="text-zinc-400" /></button>
          </div>

          <div className="space-y-6">
             {/* AI Tools Section */}
             <div className="grid grid-cols-2 gap-3">
                <Button 
                    variant="secondary" 
                    className="w-full py-3 bg-gradient-to-r from-purple-900/20 to-blue-900/20 border border-purple-500/30 flex-col gap-1 h-20"
                    onClick={() => {
                        setAiMode('edit');
                        setShowAIModal(true);
                    }}
                >
                    <Sparkles size={20} className="text-purple-400" />
                    <span className="text-xs">Magic Remix</span>
                </Button>

                <Button 
                    variant="secondary" 
                    className={`w-full py-3 border flex-col gap-1 h-20 ${activeLayer.isMasked ? 'border-blue-500/50 bg-blue-900/20' : 'border-zinc-700'}`}
                    onClick={handleRemoveBackground}
                    disabled={aiState.isLoading}
                >
                    {aiState.isLoading ? (
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : activeLayer.isMasked ? (
                        <>
                            <RefreshCcw size={20} className="text-blue-400" />
                            <span className="text-xs">Restore Original</span>
                        </>
                    ) : (
                        <>
                            <Scissors size={20} className="text-zinc-300" />
                            <span className="text-xs">Remove BG</span>
                        </>
                    )}
                </Button>
             </div>

             <div className="h-px bg-zinc-800 w-full" />

             <div className="space-y-4">
                <Slider 
                  label="Opacity" 
                  min={0} max={1} step={0.01} 
                  value={activeLayer.opacity} 
                  onChange={(v) => updateLayer(activeLayer.id, { opacity: v })} 
                />
                <Slider 
                  label="Rotation" 
                  min={-180} max={180} 
                  value={activeLayer.rotation} 
                  onChange={(v) => updateLayer(activeLayer.id, { rotation: v })} 
                />
                <Slider 
                  label="Scale" 
                  min={0.1} max={3} step={0.1}
                  value={activeLayer.scale} 
                  onChange={(v) => updateLayer(activeLayer.id, { scale: v })} 
                />
             </div>

             <div className="h-px bg-zinc-800 w-full" />

             {/* Color Correction Section */}
             <div className="space-y-4">
                <div className="flex justify-between items-center">
                    <h4 className="text-xs font-semibold text-zinc-300">Color Correction</h4>
                    <button 
                        onClick={() => updateLayer(activeLayer.id, { colorCorrection: { ...DEFAULT_COLOR_CORRECTION } })}
                        className="text-[10px] text-blue-400 hover:text-blue-300"
                    >
                        Reset
                    </button>
                </div>
                <Slider 
                    label="Brightness" 
                    min={0} max={200} 
                    value={activeLayer.colorCorrection.brightness} 
                    onChange={(v) => updateLayer(activeLayer.id, { colorCorrection: { ...activeLayer.colorCorrection, brightness: v } })} 
                />
                <Slider 
                    label="Contrast" 
                    min={0} max={200} 
                    value={activeLayer.colorCorrection.contrast} 
                    onChange={(v) => updateLayer(activeLayer.id, { colorCorrection: { ...activeLayer.colorCorrection, contrast: v } })} 
                />
                <Slider 
                    label="Saturation" 
                    min={0} max={200} 
                    value={activeLayer.colorCorrection.saturation} 
                    onChange={(v) => updateLayer(activeLayer.id, { colorCorrection: { ...activeLayer.colorCorrection, saturation: v } })} 
                />
                <Slider 
                    label="Hue" 
                    min={-180} max={180} 
                    value={activeLayer.colorCorrection.hue} 
                    onChange={(v) => updateLayer(activeLayer.id, { colorCorrection: { ...activeLayer.colorCorrection, hue: v } })} 
                />
                <Slider 
                    label="Blur" 
                    min={0} max={20} step={0.5}
                    value={activeLayer.colorCorrection.blur} 
                    onChange={(v) => updateLayer(activeLayer.id, { colorCorrection: { ...activeLayer.colorCorrection, blur: v } })} 
                />
             </div>

             <div className="h-px bg-zinc-800 w-full" />

             <div className="space-y-2">
                <label className="text-xs text-zinc-400">Blend Mode</label>
                <div className="grid grid-cols-3 gap-2">
                   {BLEND_MODES.map(mode => (
                      <button
                        key={mode.value}
                        onClick={() => updateLayer(activeLayer.id, { blendMode: mode.value })}
                        className={`text-xs p-2 rounded border ${
                           activeLayer.blendMode === mode.value 
                           ? 'bg-blue-600 border-blue-500 text-white' 
                           : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700'
                        }`}
                      >
                        {mode.label}
                      </button>
                   ))}
                </div>
             </div>
          </div>
        </div>
      )}

      {/* --- AI Modal --- */}
      <Modal 
        isOpen={showAIModal} 
        onClose={() => setShowAIModal(false)} 
        title={aiMode === 'create' ? "Generate New Asset" : "Magic Remix Layer"}
      >
         <div className="space-y-4">
            <p className="text-sm text-zinc-400">
              {aiMode === 'create' 
                ? "Describe an image you want to add to your composition." 
                : "Describe how you want to change the selected layer."}
            </p>
            <textarea 
               className="w-full bg-zinc-950 border border-zinc-700 rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none h-32"
               placeholder={aiMode === 'create' ? "e.g., A glowing neon triangle in deep space" : "e.g., Make it look like a sketch"}
               value={aiPrompt}
               onChange={(e) => setAiPrompt(e.target.value)}
            />
            
            {aiState.error && (
              <div className="text-red-400 text-xs bg-red-500/10 p-2 rounded border border-red-500/20">
                {aiState.error}
              </div>
            )}

            <Button 
              className="w-full" 
              onClick={handleAIGenerate}
              disabled={aiState.isLoading || !aiPrompt.trim()}
            >
              {aiState.isLoading ? (
                 <>
                   <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                   Thinking...
                 </>
              ) : (
                 <>
                   <Wand2 size={16} />
                   {aiMode === 'create' ? 'Generate' : 'Remix'}
                 </>
              )}
            </Button>
         </div>
      </Modal>

    </div>
  );
}
