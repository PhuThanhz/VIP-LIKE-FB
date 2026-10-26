package com.viplike.radiant.repository;

import com.viplike.radiant.model.SocialAccount;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import java.util.List;

@Repository
public interface SocialAccountRepository extends JpaRepository<SocialAccount, Long> {
    List<SocialAccount> findByUserIdOrderByIdDesc(Long userId);
    List<SocialAccount> findAllByOrderByIdDesc();
}
