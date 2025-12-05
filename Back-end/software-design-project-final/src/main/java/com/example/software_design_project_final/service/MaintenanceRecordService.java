package com.example.software_design_project_final.service;

import com.example.software_design_project_final.dao.Annotation;
import com.example.software_design_project_final.dao.Image;
import com.example.software_design_project_final.dao.Inspection;
import com.example.software_design_project_final.dao.MaintenanceRecord;
import com.example.software_design_project_final.dao.MaintenanceRecordNote;
import com.example.software_design_project_final.dao.Transformer;
import com.example.software_design_project_final.dto.MaintenanceRecordHistoryItem;
import com.example.software_design_project_final.dto.MaintenanceRecordRequest;
import com.example.software_design_project_final.dto.MaintenanceRecordResponse;
import com.example.software_design_project_final.exception.ResourceNotFoundException;
import com.example.software_design_project_final.repository.AnnotationRepository;
import com.example.software_design_project_final.repository.ImageRepository;
import com.example.software_design_project_final.repository.InspectionRepository;
import com.example.software_design_project_final.repository.MaintenanceRecordRepository;
import com.example.software_design_project_final.repository.TransformerRepository;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Service layer for generating, saving, and retrieving maintenance records.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class MaintenanceRecordService {

    private final MaintenanceRecordRepository maintenanceRecordRepository;
    private final TransformerRepository transformerRepository;
    private final InspectionRepository inspectionRepository;
    private final ImageRepository imageRepository;
    private final AnnotationRepository annotationRepository;
    private final ObjectMapper objectMapper;

    @Transactional(readOnly = true)
    public MaintenanceRecordResponse loadDraft(Integer transformerId, Integer inspectionId) {
        if (transformerId == null) {
            throw new IllegalArgumentException("transformerId is required to generate a maintenance record draft");
        }

        Transformer transformer = transformerRepository.findById(transformerId)
                .orElseThrow(() -> new ResourceNotFoundException("Transformer not found with id: " + transformerId));

        Optional<MaintenanceRecord> existingRecord = Optional.empty();
        if (inspectionId != null) {
            existingRecord = maintenanceRecordRepository
                    .findTopByTransformer_IdAndInspection_IdOrderByCreatedAtDesc(transformerId, inspectionId);
        }

        if (existingRecord.isEmpty() && inspectionId == null) {
            existingRecord = maintenanceRecordRepository.findTopByTransformer_IdOrderByCreatedAtDesc(transformerId);
        }

        if (existingRecord.isPresent()) {
            return toResponse(existingRecord.get(), true);
        }

        Inspection inspection = null;
        if (inspectionId != null) {
            inspection = inspectionRepository.findById(inspectionId)
                    .orElseThrow(() -> new ResourceNotFoundException("Inspection not found with id: " + inspectionId));
        }

        Image maintenanceImage = resolveMaintenanceImage(transformerId, inspection);
        // Fallback: if inspectionId not provided, derive inspection from maintenance image
        if (inspection == null && maintenanceImage != null && maintenanceImage.getInspection() != null) {
            inspection = maintenanceImage.getInspection();
        }
        List<Annotation> annotations = loadAnnotations(transformerId, inspection, maintenanceImage);

        MaintenanceRecordResponse response = new MaintenanceRecordResponse();
        response.setVersion(1);
        response.setTransformer(toTransformerSummary(transformer));
        response.setInspection(inspection != null ? toInspectionSummary(inspection) : null);
        response.setMaintenanceImage(toImageSummary(maintenanceImage));
        response.setEngineerFields(defaultEngineerFields(inspection));
        response.setAnomalies(toAnomalyDtos(annotations, new java.util.HashMap<>()));
        response.setHistory(loadHistory(transformerId, inspectionId));
        return response;
    }

    @Transactional(readOnly = true)
    public MaintenanceRecordResponse loadRecord(Integer recordId) {
        MaintenanceRecord record = maintenanceRecordRepository.findById(recordId)
                .orElseThrow(() -> new ResourceNotFoundException("Maintenance record not found with id: " + recordId));
        return toResponse(record, false);
    }

    @Transactional(readOnly = true)
    public List<MaintenanceRecordHistoryItem> loadHistory(Integer transformerId, Integer inspectionId) {
        List<MaintenanceRecord> records;
        if (inspectionId != null) {
            records = maintenanceRecordRepository
                    .findByTransformer_IdAndInspection_IdOrderByCreatedAtDesc(transformerId, inspectionId);
        } else {
            records = maintenanceRecordRepository.findByTransformer_IdOrderByCreatedAtDesc(transformerId);
        }

        return records.stream()
                .map(this::toHistoryItem)
                .collect(Collectors.toList());
    }

    @Transactional
    public MaintenanceRecordResponse saveRecord(MaintenanceRecordRequest request) {
        if (request.getTransformerId() == null) {
            throw new IllegalArgumentException("transformerId is required");
        }

        Transformer transformer = transformerRepository.findById(request.getTransformerId())
                .orElseThrow(() -> new ResourceNotFoundException("Transformer not found with id: " + request.getTransformerId()));

        Inspection inspection = null;
        if (request.getInspectionId() != null) {
            inspection = inspectionRepository.findById(request.getInspectionId())
                    .orElseThrow(() -> new ResourceNotFoundException("Inspection not found with id: " + request.getInspectionId()));
        }

        Image maintenanceImage = null;
        if (request.getMaintenanceImageId() != null) {
            maintenanceImage = imageRepository.findById(request.getMaintenanceImageId())
                    .orElseThrow(() -> new ResourceNotFoundException("Image not found with id: " + request.getMaintenanceImageId()));
        } else {
            maintenanceImage = resolveMaintenanceImage(transformer.getId(), inspection);
        }

        MaintenanceRecord existingRecord = null;
        int nextVersion = 1;
        if (request.getId() != null) {
            existingRecord = maintenanceRecordRepository.findById(request.getId())
                    .orElseThrow(() -> new ResourceNotFoundException("Maintenance record not found with id: " + request.getId()));
            if (!existingRecord.getTransformer().getId().equals(transformer.getId())) {
                throw new IllegalArgumentException("Transformer mismatch for maintenance record update");
            }
            int currentVersion = existingRecord.getVersion() != null ? existingRecord.getVersion() : 1;
            if (request.getVersion() != null && !request.getVersion().equals(currentVersion)) {
                throw new IllegalArgumentException("Maintenance record has been updated by another user");
            }
            nextVersion = currentVersion + 1;
        }

        MaintenanceRecord record = new MaintenanceRecord();
        record.setTransformer(transformer);
        record.setInspection(inspection);
        record.setMaintenanceImage(maintenanceImage);
        record.setVersion(nextVersion);

        applyEngineerFields(record, request.getEngineerFields(), inspection);

        Map<Integer, String> noteMap = new HashMap<>();
        request.getAnomalyNotes().forEach((key, value) -> {
            Integer annotationId = safeParseInt(key);
            String noteValue = trimToNull(value);
            if (annotationId != null && StringUtils.hasText(noteValue)) {
                noteMap.put(annotationId, noteValue);
            }
        });

        record.getAnomalyNotes().clear();
        noteMap.forEach((annotationId, noteValue) -> {
            MaintenanceRecordNote note = new MaintenanceRecordNote();
            note.setRecord(record);
            note.setAnnotationId(annotationId);
            note.setNote(noteValue);
            note.setAnomalySnapshot(buildSnapshot(annotationId));
            record.getAnomalyNotes().add(note);
        });

        MaintenanceRecord savedRecord = maintenanceRecordRepository.save(record);
        return toResponse(savedRecord, false);
    }

    private void applyEngineerFields(MaintenanceRecord record, MaintenanceRecordRequest.EngineerFields fields, Inspection inspection) {
        if (fields == null) {
            fields = new MaintenanceRecordRequest.EngineerFields();
        }

        record.setInspectorName(trimToNull(fields.getInspectorName()));
        record.setVoltage(trimToNull(fields.getVoltage()));
        record.setCurrent(trimToNull(fields.getCurrent()));
        record.setRecommendedAction(trimToNull(fields.getRecommendedAction()));
        record.setCorrectiveAction(trimToNull(fields.getCorrectiveAction()));
        record.setAdditionalRemarks(trimToNull(fields.getAdditionalRemarks()));

        record.setInspectionDate(parseDateOrDefault(fields.getInspectionDate(),
                inspection != null ? inspection.getInspectedDate() : null));
        record.setFollowUpDate(parseDateOrNull(fields.getFollowUpDate()));

        MaintenanceRecord.RecordStatus status = MaintenanceRecord.RecordStatus.fromLabel(fields.getStatus());
        record.setStatus(status);
    }

    private MaintenanceRecordResponse toResponse(MaintenanceRecord record, boolean draftFallback) {
        MaintenanceRecordResponse response = new MaintenanceRecordResponse();
        response.setId(record.getId());
        response.setVersion(record.getVersion());
        response.setCreatedAt(record.getCreatedAt());
        response.setUpdatedAt(record.getUpdatedAt());
        response.setTransformer(toTransformerSummary(record.getTransformer()));
        response.setInspection(record.getInspection() != null ? toInspectionSummary(record.getInspection()) : null);
        response.setMaintenanceImage(toImageSummary(record.getMaintenanceImage()));
        response.setEngineerFields(toEngineerFields(record));

        List<Annotation> annotations = loadAnnotations(
                record.getTransformer().getId(),
                record.getInspection(),
                record.getMaintenanceImage());

        Map<Integer, MaintenanceRecordNote> noteMap = record.getAnomalyNotes().stream()
                .filter(note -> note.getAnnotationId() != null)
                .collect(Collectors.toMap(MaintenanceRecordNote::getAnnotationId, note -> note, (left, right) -> right));

        Map<Integer, MaintenanceRecordNote> remainingNotes = new java.util.HashMap<>(noteMap);
        List<MaintenanceRecordResponse.AnomalyDto> anomalies = toAnomalyDtos(annotations, remainingNotes);

        // Include archived notes if annotation no longer exists
        if (!remainingNotes.isEmpty()) {
            Set<Integer> existingIds = annotations.stream()
                    .map(Annotation::getId)
                    .collect(Collectors.toSet());
            remainingNotes.entrySet().stream()
                    .filter(entry -> entry.getKey() == null || !existingIds.contains(entry.getKey()))
                    .map(entry -> toArchivedAnomaly(entry.getKey(), entry.getValue()))
                    .forEach(anomalies::add);
        }

        response.setAnomalies(anomalies);

        if (draftFallback && response.getEngineerFields() == null) {
            response.setEngineerFields(defaultEngineerFields(record.getInspection()));
        }

        if (record.getTransformer() != null) {
            Integer inspectionId = record.getInspection() != null ? record.getInspection().getId() : null;
            response.setHistory(loadHistory(record.getTransformer().getId(), inspectionId));
        }

        return response;
    }

    private MaintenanceRecordResponse.EngineerFields toEngineerFields(MaintenanceRecord record) {
        MaintenanceRecordResponse.EngineerFields fields = new MaintenanceRecordResponse.EngineerFields();
        fields.setInspectorName(record.getInspectorName());
        fields.setInspectionDate(formatDate(record.getInspectionDate()));
        fields.setStatus(record.getStatus() != null ? record.getStatus().getLabel() : MaintenanceRecord.RecordStatus.OK.getLabel());
        fields.setVoltage(record.getVoltage());
        fields.setCurrent(record.getCurrent());
        fields.setRecommendedAction(record.getRecommendedAction());
        fields.setCorrectiveAction(record.getCorrectiveAction());
        fields.setAdditionalRemarks(record.getAdditionalRemarks());
        fields.setFollowUpDate(formatDate(record.getFollowUpDate()));
        return fields;
    }

    private MaintenanceRecordResponse.EngineerFields defaultEngineerFields(Inspection inspection) {
        MaintenanceRecordResponse.EngineerFields fields = new MaintenanceRecordResponse.EngineerFields();
        fields.setStatus(MaintenanceRecord.RecordStatus.OK.getLabel());
        if (inspection != null && inspection.getInspectedDate() != null) {
            fields.setInspectionDate(inspection.getInspectedDate().toLocalDate().toString());
        }
        return fields;
    }

    private MaintenanceRecordResponse.TransformerSummary toTransformerSummary(Transformer transformer) {
        if (transformer == null) {
            return null;
        }
        return new MaintenanceRecordResponse.TransformerSummary(
                transformer.getId(),
                transformer.getTransformerNo(),
                transformer.getLocation(),
                transformer.getRegion() != null ? transformer.getRegion().name() : null,
                transformer.getPole_no(),
                transformer.getTransformerType() != null ? transformer.getTransformerType().name() : null
        );
    }

    private MaintenanceRecordResponse.InspectionSummary toInspectionSummary(Inspection inspection) {
        return new MaintenanceRecordResponse.InspectionSummary(
                inspection.getId(),
                inspection.getInspectionNo(),
                inspection.getBranch(),
                inspection.getStatus() != null ? inspection.getStatus().getDisplayName() : null,
                inspection.getInspectedBy(),
                inspection.getInspectedDate() != null ? inspection.getInspectedDate().toString() : null,
                inspection.getMaintenanceDate() != null ? inspection.getMaintenanceDate().toString() : null
        );
    }

    private MaintenanceRecordResponse.ImageSummary toImageSummary(Image image) {
        if (image == null) {
            return null;
        }
        return new MaintenanceRecordResponse.ImageSummary(
                image.getId(),
                image.getFileName(),
                image.getFilePath(),
                image.getImageType() != null ? image.getImageType().name() : null,
                image.getEnvCondition() != null ? image.getEnvCondition().name() : null,
                image.getUploadDate() != null ? image.getUploadDate().toString() : null,
                image.getCreatedAt() != null ? image.getCreatedAt().toString() : null,
                image.getInspection() != null ? image.getInspection().getId() : null,
                image.getTransformer() != null ? image.getTransformer().getId() : null
        );
    }

    private List<MaintenanceRecordResponse.AnomalyDto> toAnomalyDtos(List<Annotation> annotations,
                                                                     Map<Integer, MaintenanceRecordNote> noteMap) {
        List<MaintenanceRecordResponse.AnomalyDto> results = new ArrayList<>();

        for (Annotation annotation : annotations) {
            MaintenanceRecordResponse.AnomalyDto dto = new MaintenanceRecordResponse.AnomalyDto();
            dto.setId(annotation.getId());
            dto.setAnomalyId(annotation.getId());
            dto.setImageId(annotation.getImage() != null ? annotation.getImage().getId() : null);
            dto.setErrorType(annotation.getClassName());
            dto.setConfidence(annotation.getConfidenceScore() != null ? annotation.getConfidenceScore().doubleValue() : null);
            dto.setConfidenceLabel(annotation.getConfidenceScore() != null
                    ? String.format(Locale.ENGLISH, "%.0f%%", annotation.getConfidenceScore() * 100)
                    : null);
            dto.setSeverityLevel(resolveSeverity(annotation.getClassName()));
            dto.setAnnotationType(annotation.getAnnotationType() != null ? annotation.getAnnotationType().name() : null);
            dto.setBoundingBox(new MaintenanceRecordResponse.BoundingBox(
                    toDouble(annotation.getBboxX1()),
                    toDouble(annotation.getBboxY1()),
                    toDouble(annotation.getBboxX2()),
                    toDouble(annotation.getBboxY2())));
            dto.setCreatedAt(annotation.getCreatedAt() != null ? annotation.getCreatedAt().toString() : null);

            MaintenanceRecordNote note = noteMap.get(annotation.getId());
            if (note != null) {
                dto.setEngineerNote(note.getNote());
                noteMap.remove(annotation.getId());
            }

            results.add(dto);
        }
        return results;
    }

    private MaintenanceRecordResponse.AnomalyDto toArchivedAnomaly(Integer annotationId, MaintenanceRecordNote note) {
        MaintenanceRecordResponse.AnomalyDto dto = null;
        if (StringUtils.hasText(note.getAnomalySnapshot())) {
            try {
                dto = objectMapper.readValue(note.getAnomalySnapshot(), MaintenanceRecordResponse.AnomalyDto.class);
            } catch (JsonProcessingException e) {
                log.debug("Failed to deserialize anomaly snapshot for annotation {}: {}", annotationId, e.getMessage());
            }
        }

        if (dto == null) {
            dto = new MaintenanceRecordResponse.AnomalyDto();
            dto.setSeverityLevel("LOW");
            dto.setErrorType("Archived Anomaly");
        }

        dto.setAnomalyId(annotationId);
        dto.setEngineerNote(note.getNote());
        dto.setArchived(true);
        return dto;
    }

    private Image resolveMaintenanceImage(Integer transformerId, Inspection inspection) {
        Image image = null;
        if (inspection != null) {
            image = imageRepository.findTopByInspection_IdAndImageTypeOrderByUploadDateDesc(
                    inspection.getId(), Image.ImageType.MAINTENANCE);
        }
        if (image == null) {
            image = imageRepository.findTopByTransformer_IdAndImageTypeOrderByUploadDateDesc(
                    transformerId, Image.ImageType.MAINTENANCE);
        }
        return image;
    }

    private List<Annotation> loadAnnotations(Integer transformerId, Inspection inspection, Image maintenanceImage) {
        if (maintenanceImage != null) {
            return annotationRepository.findActiveAnnotationsByImageId(maintenanceImage.getId());
        }
        if (inspection != null) {
            return annotationRepository.findAnnotationsByInspectionId(inspection.getId());
        }
        return annotationRepository.findAnnotationsByTransformerId(transformerId);
    }

    private String trimToNull(String value) {
        return StringUtils.hasText(value) ? value.trim() : null;
    }

    private LocalDate parseDateOrDefault(String value, LocalDateTime fallback) {
        LocalDate parsed = parseDateOrNull(value);
        if (parsed != null) {
            return parsed;
        }
        if (fallback != null) {
            return fallback.toLocalDate();
        }
        return null;
    }

    private LocalDate parseDateOrNull(String value) {
        if (!StringUtils.hasText(value)) {
            return null;
        }
        try {
            return LocalDate.parse(value.trim());
        } catch (Exception ex) {
            throw new IllegalArgumentException("Invalid date format: " + value);
        }
    }

    private String formatDate(LocalDate date) {
        return date != null ? date.toString() : null;
    }

    private String buildSnapshot(Integer annotationId) {
        if (annotationId == null) {
            return null;
        }
        return annotationRepository.findById(annotationId)
                .map(annotation -> {
                    MaintenanceRecordResponse.AnomalyDto dto = new MaintenanceRecordResponse.AnomalyDto();
                    dto.setId(annotation.getId());
                    dto.setAnomalyId(annotation.getId());
                    dto.setImageId(annotation.getImage() != null ? annotation.getImage().getId() : null);
                    dto.setErrorType(annotation.getClassName());
                    dto.setConfidence(annotation.getConfidenceScore() != null ? annotation.getConfidenceScore().doubleValue() : null);
                    dto.setSeverityLevel(resolveSeverity(annotation.getClassName()));
                    dto.setAnnotationType(annotation.getAnnotationType() != null ? annotation.getAnnotationType().name() : null);
                    dto.setBoundingBox(new MaintenanceRecordResponse.BoundingBox(
                            toDouble(annotation.getBboxX1()),
                            toDouble(annotation.getBboxY1()),
                            toDouble(annotation.getBboxX2()),
                            toDouble(annotation.getBboxY2())));
                    dto.setCreatedAt(annotation.getCreatedAt() != null ? annotation.getCreatedAt().toString() : null);
                    try {
                        return objectMapper.writeValueAsString(dto);
                    } catch (JsonProcessingException e) {
                        log.debug("Failed to serialize anomaly snapshot: {}", e.getMessage());
                        return null;
                    }
                })
                .orElse(null);
    }

    private double toDouble(Float value) {
        return value != null ? value.doubleValue() : 0.0d;
    }

    private String resolveSeverity(String className) {
        if (!StringUtils.hasText(className)) {
            return "LOW";
        }
        String lower = className.toLowerCase(Locale.ROOT);
        if (lower.contains(" pf") || lower.contains("potentially")) {
            return "HIGH";
        } else if (lower.contains(" f") && !lower.contains(" pf")) {
            return "CRITICAL";
        } else if (lower.contains("transformer overload")) {
            return "MEDIUM";
        } else if (lower.contains("overload") || lower.contains("loose joint")) {
            return "HIGH";
        }
        return "LOW";
    }

    private MaintenanceRecordHistoryItem toHistoryItem(MaintenanceRecord record) {
        return new MaintenanceRecordHistoryItem(
                record.getId(),
                record.getVersion(),
                record.getStatus() != null ? record.getStatus().getLabel() : MaintenanceRecord.RecordStatus.OK.getLabel(),
                record.getInspectorName(),
                record.getInspection() != null ? record.getInspection().getId() : null,
                formatDate(record.getInspectionDate()),
                record.getMaintenanceImage() != null ? record.getMaintenanceImage().getFileName() : null,
                record.getCreatedAt() != null ? record.getCreatedAt().toString() : null,
                record.getUpdatedAt() != null ? record.getUpdatedAt().toString() : null
        );
    }

    private Integer safeParseInt(String value) {
        if (!StringUtils.hasText(value)) {
            return null;
        }
        try {
            return Integer.parseInt(value.trim());
        } catch (NumberFormatException ex) {
            return null;
        }
    }
}
