#pragma once

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Shared-memory protocol v1 for Gridiron OCR OBS capture.
 * Must stay byte-compatible with PC/ocr-sidecar/ocr_sidecar/shared_frame.py
 */

#define GRIDIRON_OCR_CONTROL_MAP_NAME "Local\\GridironOcrObsControlV1"
#define GRIDIRON_OCR_FRAME_MAP_NAME "Local\\GridironOcrObsFramesV1"

#define GRIDIRON_OCR_CONTROL_MAGIC "GOCCTL1"
#define GRIDIRON_OCR_FRAME_MAGIC "GOCFRM1"
#define GRIDIRON_OCR_PROTOCOL_VERSION 1u
#define GRIDIRON_OCR_PIXEL_FORMAT_BGRA8 1u

#define GRIDIRON_OCR_MAX_WIDTH 4096u
#define GRIDIRON_OCR_MAX_HEIGHT 2160u
#define GRIDIRON_OCR_BYTES_PER_PIXEL 4u
#define GRIDIRON_OCR_SLOT_CAPACITY \
  (GRIDIRON_OCR_MAX_WIDTH * GRIDIRON_OCR_MAX_HEIGHT * GRIDIRON_OCR_BYTES_PER_PIXEL)
#define GRIDIRON_OCR_SOURCE_CAPACITY 1024u

#pragma pack(push, 1)
typedef struct GridironOcrControlHeader {
  char magic[8];
  uint32_t version;
  uint32_t header_size;
  uint64_t source_generation;
  uint32_t source_length;
  uint32_t source_capacity;
} GridironOcrControlHeader;

typedef struct GridironOcrFrameHeader {
  char magic[8];
  uint32_t version;
  uint32_t header_size;
  uint64_t slot_capacity;
  uint64_t sequence;
  uint32_t active_slot;
  uint32_t width;
  uint32_t height;
  uint32_t stride;
  uint32_t pixel_format;
  uint32_t reserved0;
  uint64_t captured_qpc;
  uint64_t qpc_frequency;
  uint64_t reserved1;
} GridironOcrFrameHeader;
#pragma pack(pop)

#define GRIDIRON_OCR_CONTROL_MAP_SIZE \
  (sizeof(GridironOcrControlHeader) + GRIDIRON_OCR_SOURCE_CAPACITY)
#define GRIDIRON_OCR_FRAME_MAP_SIZE \
  (sizeof(GridironOcrFrameHeader) + (2ull * GRIDIRON_OCR_SLOT_CAPACITY))

#ifdef __cplusplus
}
#endif
