#include "gridiron_ocr_protocol.h"

#include <obs-module.h>
#include <graphics/graphics.h>

#include <atomic>
#include <cstring>
#include <string>

#include <windows.h>

OBS_DECLARE_MODULE()
OBS_MODULE_USE_DEFAULT_LOCALE("gridiron-ocr-capture", "en-US")

MODULE_EXPORT const char *obs_module_description(void)
{
	return "Gridiron OCR shared-frame capture bridge";
}

namespace {

struct SharedMaps {
	HANDLE control_mapping = nullptr;
	HANDLE frame_mapping = nullptr;
	uint8_t *control_view = nullptr;
	uint8_t *frame_view = nullptr;
};

struct CaptureState {
	SharedMaps maps;
	gs_texrender_t *texrender = nullptr;
	gs_stagesurf_t *stagesurf = nullptr;
	uint32_t stage_width = 0;
	uint32_t stage_height = 0;
	std::string selected_source;
	uint64_t last_generation = 0;
	uint64_t sequence = 0;
	bool stage_pending = false;
	uint32_t pending_slot = 0;
	uint32_t pending_width = 0;
	uint32_t pending_height = 0;
	uint32_t pending_stride = 0;
	uint64_t pending_qpc = 0;
};

CaptureState *g_state = nullptr;

bool open_maps(SharedMaps &maps)
{
	maps.control_mapping = CreateFileMappingA(
		INVALID_HANDLE_VALUE, nullptr, PAGE_READWRITE, 0,
		(DWORD)GRIDIRON_OCR_CONTROL_MAP_SIZE, GRIDIRON_OCR_CONTROL_MAP_NAME);
	if (!maps.control_mapping)
		return false;
	maps.frame_mapping = CreateFileMappingA(
		INVALID_HANDLE_VALUE, nullptr, PAGE_READWRITE,
		(DWORD)(GRIDIRON_OCR_FRAME_MAP_SIZE >> 32),
		(DWORD)(GRIDIRON_OCR_FRAME_MAP_SIZE & 0xffffffffu),
		GRIDIRON_OCR_FRAME_MAP_NAME);
	if (!maps.frame_mapping)
		return false;
	maps.control_view = (uint8_t *)MapViewOfFile(
		maps.control_mapping, FILE_MAP_ALL_ACCESS, 0, 0, GRIDIRON_OCR_CONTROL_MAP_SIZE);
	maps.frame_view = (uint8_t *)MapViewOfFile(
		maps.frame_mapping, FILE_MAP_ALL_ACCESS, 0, 0, (SIZE_T)GRIDIRON_OCR_FRAME_MAP_SIZE);
	return maps.control_view && maps.frame_view;
}

void close_maps(SharedMaps &maps)
{
	if (maps.control_view) {
		UnmapViewOfFile(maps.control_view);
		maps.control_view = nullptr;
	}
	if (maps.frame_view) {
		UnmapViewOfFile(maps.frame_view);
		maps.frame_view = nullptr;
	}
	if (maps.control_mapping) {
		CloseHandle(maps.control_mapping);
		maps.control_mapping = nullptr;
	}
	if (maps.frame_mapping) {
		CloseHandle(maps.frame_mapping);
		maps.frame_mapping = nullptr;
	}
}

void init_headers(CaptureState *state)
{
	auto *control = (GridironOcrControlHeader *)state->maps.control_view;
	std::memset(state->maps.control_view, 0, GRIDIRON_OCR_CONTROL_MAP_SIZE);
	std::memcpy(control->magic, GRIDIRON_OCR_CONTROL_MAGIC, 7);
	control->magic[7] = '\0';
	control->version = GRIDIRON_OCR_PROTOCOL_VERSION;
	control->header_size = (uint32_t)sizeof(GridironOcrControlHeader);
	control->source_capacity = GRIDIRON_OCR_SOURCE_CAPACITY;

	auto *frame = (GridironOcrFrameHeader *)state->maps.frame_view;
	std::memset(state->maps.frame_view, 0, (size_t)GRIDIRON_OCR_FRAME_MAP_SIZE);
	std::memcpy(frame->magic, GRIDIRON_OCR_FRAME_MAGIC, 7);
	frame->magic[7] = '\0';
	frame->version = GRIDIRON_OCR_PROTOCOL_VERSION;
	frame->header_size = (uint32_t)sizeof(GridironOcrFrameHeader);
	frame->slot_capacity = GRIDIRON_OCR_SLOT_CAPACITY;
	frame->pixel_format = GRIDIRON_OCR_PIXEL_FORMAT_BGRA8;
	LARGE_INTEGER freq = {};
	QueryPerformanceFrequency(&freq);
	frame->qpc_frequency = (uint64_t)freq.QuadPart;
}

std::string read_selected_source(CaptureState *state, uint64_t *generation_out)
{
	auto *control = (GridironOcrControlHeader *)state->maps.control_view;
	uint64_t generation = control->source_generation;
	uint32_t length = control->source_length;
	if (length > GRIDIRON_OCR_SOURCE_CAPACITY)
		length = GRIDIRON_OCR_SOURCE_CAPACITY;
	const char *bytes = (const char *)(state->maps.control_view + sizeof(GridironOcrControlHeader));
	if (generation_out)
		*generation_out = generation;
	return std::string(bytes, bytes + length);
}

bool ensure_stage(CaptureState *state, uint32_t width, uint32_t height)
{
	if (state->stagesurf && state->stage_width == width && state->stage_height == height)
		return true;
	if (state->stagesurf) {
		gs_stagesurface_destroy(state->stagesurf);
		state->stagesurf = nullptr;
	}
	state->stagesurf = gs_stagesurface_create(width, height, GS_BGRA);
	state->stage_width = width;
	state->stage_height = height;
	return state->stagesurf != nullptr;
}

void publish_staged_pixels(CaptureState *state, const uint8_t *src, uint32_t src_stride)
{
	auto *frame = (GridironOcrFrameHeader *)state->maps.frame_view;
	const uint32_t width = state->pending_width;
	const uint32_t height = state->pending_height;
	const uint32_t stride = state->pending_stride;
	const uint32_t slot = state->pending_slot;
	uint8_t *slot_base =
		state->maps.frame_view + sizeof(GridironOcrFrameHeader) + (size_t)slot * GRIDIRON_OCR_SLOT_CAPACITY;

	for (uint32_t y = 0; y < height; ++y) {
		std::memcpy(
			slot_base + (size_t)y * stride,
			src + (size_t)y * src_stride,
			(size_t)width * GRIDIRON_OCR_BYTES_PER_PIXEL);
	}

	frame->width = width;
	frame->height = height;
	frame->stride = stride;
	frame->pixel_format = GRIDIRON_OCR_PIXEL_FORMAT_BGRA8;
	frame->captured_qpc = state->pending_qpc;
	frame->active_slot = slot;
	MemoryBarrier();
	frame->sequence = ++state->sequence;
}

void capture_tick(void *param, uint32_t, uint32_t)
{
	auto *state = (CaptureState *)param;
	if (!state || !state->maps.frame_view || !state->maps.control_view)
		return;

	if (state->stage_pending && state->stagesurf) {
		uint8_t *data = nullptr;
		uint32_t linesize = 0;
		if (gs_stagesurface_map(state->stagesurf, &data, &linesize)) {
			publish_staged_pixels(state, data, linesize);
			gs_stagesurface_unmap(state->stagesurf);
		}
		state->stage_pending = false;
	}

	uint64_t generation = 0;
	std::string source_name = read_selected_source(state, &generation);
	if (source_name.empty())
		return;
	state->selected_source = source_name;
	state->last_generation = generation;

	obs_source_t *source = obs_get_source_by_name(source_name.c_str());
	if (!source)
		return;

	const uint32_t width = obs_source_get_base_width(source);
	const uint32_t height = obs_source_get_base_height(source);
	if (width < 8 || height < 8 || width > GRIDIRON_OCR_MAX_WIDTH || height > GRIDIRON_OCR_MAX_HEIGHT) {
		obs_source_release(source);
		return;
	}
	if (!ensure_stage(state, width, height)) {
		obs_source_release(source);
		return;
	}
	if (!state->texrender)
		state->texrender = gs_texrender_create(GS_BGRA, GS_ZS_NONE);
	if (!state->texrender) {
		obs_source_release(source);
		return;
	}

	gs_texrender_reset(state->texrender);
	if (gs_texrender_begin(state->texrender, width, height)) {
		struct vec4 clear_color;
		vec4_zero(&clear_color);
		gs_clear(GS_CLEAR_COLOR, &clear_color, 0.0f, 0);
		gs_ortho(0.0f, (float)width, 0.0f, (float)height, -100.0f, 100.0f);
		obs_source_video_render(source);
		gs_texrender_end(state->texrender);
	}

	gs_texture_t *tex = gs_texrender_get_texture(state->texrender);
	if (tex) {
		gs_stage_texture(state->stagesurf, tex);
		LARGE_INTEGER qpc = {};
		QueryPerformanceCounter(&qpc);
		state->pending_qpc = (uint64_t)qpc.QuadPart;
		state->pending_width = width;
		state->pending_height = height;
		state->pending_stride = width * GRIDIRON_OCR_BYTES_PER_PIXEL;
		state->pending_slot = (uint32_t)((state->sequence + 1) & 1ull);
		state->stage_pending = true;
	}

	obs_source_release(source);
}

} // namespace

bool obs_module_load(void)
{
	g_state = new CaptureState();
	if (!open_maps(g_state->maps)) {
		blog(LOG_ERROR, "[gridiron-ocr-capture] failed to create shared memory maps");
		close_maps(g_state->maps);
		delete g_state;
		g_state = nullptr;
		return false;
	}
	init_headers(g_state);
	obs_add_main_render_callback(capture_tick, g_state);
	blog(LOG_INFO, "[gridiron-ocr-capture] shared-frame bridge loaded");
	return true;
}

void obs_module_unload(void)
{
	if (!g_state)
		return;
	obs_remove_main_render_callback(capture_tick, g_state);
	obs_enter_graphics();
	if (g_state->texrender) {
		gs_texrender_destroy(g_state->texrender);
		g_state->texrender = nullptr;
	}
	if (g_state->stagesurf) {
		gs_stagesurface_destroy(g_state->stagesurf);
		g_state->stagesurf = nullptr;
	}
	obs_leave_graphics();
	close_maps(g_state->maps);
	delete g_state;
	g_state = nullptr;
	blog(LOG_INFO, "[gridiron-ocr-capture] shared-frame bridge unloaded");
}
