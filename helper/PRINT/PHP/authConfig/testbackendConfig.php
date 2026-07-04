<?php
    date_default_timezone_set('Asia/Kolkata');
    
    define('DB_HOST_1', 'localhost'); // Host Name
    define('DB_USER_1', 'mscorpre_ims_user'); // DB Username
    define('DB_PASS_1', 'OWdbJTL3U=?U'); // DB User Password
    
    define('DB_VANS_INVT', 'mscorpre_vans_ims'); // DB VANS
    
    define('DB_OAKTER_INVT', 'test_ims_invt');
    define('DB_OAKTER_TALLY', 'test_ims_tally');
    define('DB_OAKTER_HOST',"207.180.216.86");
    define('DB_OAKTER_USER',"test_imsUser");
    define('DB_OAKTER_PASS',"9$@ZeUB0@070");
    
    // Establish DB Connection
    
    try {
        $con = new PDO("mysql:host=" . DB_OAKTER_HOST . ";charset=UTF8;dbname=" . DB_OAKTER_INVT, DB_OAKTER_USER, DB_OAKTER_PASS);
    } catch (PDOException $e) {
        echo 'We are not able to connect Inventory';
        exit;
    }
    
     try {
        $con_tally = new PDO("mysql:host=" . DB_OAKTER_HOST . ";charset=UTF8;dbname=" . DB_OAKTER_TALLY, DB_OAKTER_USER, DB_OAKTER_PASS);
    } catch (PDOException $e) {
        echo 'We are not able to connect Inventory';
        exit;
    }
    
    
    try {
        $vans = new PDO("mysql:host=" . DB_HOST_1 . ";charset=UTF8;dbname=" . DB_VANS_INVT, DB_USER_1, DB_PASS_1);
    } catch (PDOException $e) {
        echo 'We are not able to connect VANS';
        exit;
    }
?>
