package com.viplike.radiant.repository;

import com.viplike.radiant.model.SoftwareLicense;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import java.util.List;
import java.util.Optional;

@Repository
public interface SoftwareLicenseRepository extends JpaRepository<SoftwareLicense, Long> {
    Optional<SoftwareLicense> findByLicenseKey(String licenseKey);
    Optional<SoftwareLicense> findFirstByStatusOrderByCreatedAtDesc(String status);
    List<SoftwareLicense> findAllByOrderByCreatedAtDesc();
    boolean existsByLicenseKey(String licenseKey);
}
